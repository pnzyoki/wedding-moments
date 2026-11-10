import crypto from 'node:crypto';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

let cachedToken = null;
let tokenExpiresAt = 0;

/**
 * Check if Google Drive is configured via environment variables
 */
export function isGoogleDriveConfigured() {
  return Boolean(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY &&
    process.env.GOOGLE_DRIVE_FOLDER_ID
  );
}

/**
 * Clean and format RSA private key (handling escaped \n from env vars)
 */
function getFormattedPrivateKey() {
  let key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '';
  key = key.replace(/\\n/g, '\n').trim();
  if (key.startsWith('"') && key.endsWith('"')) {
    key = key.slice(1, -1);
  }
  return key;
}

/**
 * Exchange Service Account JWT for a Google OAuth2 access token
 */
export async function getGoogleAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && tokenExpiresAt > now + 60) {
    return cachedToken;
  }

  const clientEmail = (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim();
  const privateKey = getFormattedPrivateKey();

  if (!clientEmail || !privateKey) {
    throw new Error('Google Drive service account credentials are not configured.');
  }

  const header = { alg: 'RS256', typ: 'JWT' };
  const claimSet = {
    iss: clientEmail,
    scope: DRIVE_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    exp: now + 3600,
    iat: now
  };

  const b64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
  const b64Claim = Buffer.from(JSON.stringify(claimSet)).toString('base64url');
  const signatureInput = `${b64Header}.${b64Claim}`;

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signatureInput);
  const signature = signer.sign(privateKey, 'base64url');

  const jwt = `${signatureInput}.${signature}`;

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google OAuth token exchange failed (${res.status}): ${errText}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiresAt = now + (data.expires_in || 3600);
  return cachedToken;
}

/**
 * Upload a photo buffer directly to Google Drive folder
 */
export async function uploadToGoogleDrive({ buffer, filename, mimetype, author }) {
  if (!isGoogleDriveConfigured()) return null;

  const folderId = (process.env.GOOGLE_DRIVE_FOLDER_ID || '').trim();
  const accessToken = await getGoogleAccessToken();

  const metadata = {
    name: filename,
    parents: [folderId],
    description: author ? `Uploaded to Wedding Moments by ${author}` : 'Uploaded to Wedding Moments'
  };

  const boundary = `----WeddingMomentsBoundary${crypto.randomBytes(8).toString('hex')}`;
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const metaHeader = `${delimiter}Content-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`;
  const fileHeader = `${delimiter}Content-Type: ${mimetype || 'image/jpeg'}\r\n\r\n`;

  const metaBuf = Buffer.from(metaHeader, 'utf-8');
  const fileHeadBuf = Buffer.from(fileHeader, 'utf-8');
  const closeBuf = Buffer.from(closeDelimiter, 'utf-8');

  const multipartBody = Buffer.concat([
    metaBuf,
    fileHeadBuf,
    buffer,
    closeBuf
  ]);

  const uploadUrl = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,webContentLink,size';

  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
      'Content-Length': String(multipartBody.length)
    },
    body: multipartBody
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google Drive upload failed (${res.status}): ${errText}`);
  }

  const result = await res.json();
  return {
    gdriveFileId: result.id,
    gdriveWebViewLink: result.webViewLink || `https://drive.google.com/file/d/${result.id}/view`,
    gdriveWebContentLink: result.webContentLink || null,
    gdriveName: result.name
  };
}

/**
 * Check Google Drive connection and retrieve target folder details
 */
export async function getGoogleDriveStatus() {
  if (!isGoogleDriveConfigured()) {
    return {
      configured: false,
      folderId: null,
      folderName: null,
      folderLink: null
    };
  }

  const folderId = (process.env.GOOGLE_DRIVE_FOLDER_ID || '').trim();
  const folderLink = `https://drive.google.com/drive/folders/${folderId}`;

  try {
    const accessToken = await getGoogleAccessToken();
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${folderId}?fields=id,name,capabilities`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (res.ok) {
      const data = await res.json();
      return {
        configured: true,
        accessible: true,
        folderId,
        folderName: data.name || 'Wedding Photos',
        folderLink
      };
    } else {
      const err = await res.json().catch(() => ({}));
      return {
        configured: true,
        accessible: false,
        error: err.error?.message || `HTTP ${res.status}`,
        folderId,
        folderLink
      };
    }
  } catch (err) {
    return {
      configured: true,
      accessible: false,
      error: err.message,
      folderId,
      folderLink
    };
  }
}
