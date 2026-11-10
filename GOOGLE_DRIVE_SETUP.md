# Google Drive Storage Integration Guide

This guide explains how to connect your personal Google Account to **Wedding Moments** so that every photo uploaded by guests is automatically saved directly to a dedicated folder in your Google Drive (with **15 GB of free storage**).

---

## Architecture Overview

```
Guest Upload (upload.html)
        │
        ▼
   Server API (/api/photos)
   ┌────┴───────────────────────────────────────┐
   ▼                                            ▼
Google Drive Folder                      Live Wall / Feed
(Full-resolution archive, 15 GB free)    (Optimized display image)
```

---

## Step-by-Step Setup (5 Minutes)

### Step 1: Create a Google Cloud Project
1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Click **Select a project** (top bar) > **New Project**.
3. Name it `Wedding Moments` and click **Create**.

### Step 2: Enable the Google Drive API
1. In your project, go to **APIs & Services > Library**.
2. Search for **Google Drive API**.
3. Click on it and click **Enable**.

### Step 3: Create a Free Service Account
1. Go to **APIs & Services > Credentials**.
2. Click **Create Credentials** > **Service Account**.
3. Name: `wedding-moments-uploader`.
4. Click **Create and Continue**, then click **Done**.
5. Click on the newly created service account email (e.g. `wedding-moments-uploader@wedding-moments-12345.iam.gserviceaccount.com`).
6. Go to the **Keys** tab > **Add Key** > **Create new key**.
7. Select **JSON** and click **Create**.
8. A `.json` credentials file will download to your computer.

### Step 4: Create & Share a Folder in Your Personal Google Drive
1. Open your personal [Google Drive](https://drive.google.com/).
2. Create a new folder (e.g. `Ruth & Elvis Wedding Moments`).
3. Right-click the folder > **Share** > **Share**.
4. Paste the **service account email** from Step 3 (the one ending in `@...iam.gserviceaccount.com`).
5. Ensure the permission is set to **Editor**, uncheck "Notify people", and click **Share**.
6. Open the folder and look at the browser address bar:
   `https://drive.google.com/drive/folders/1a2b3c4d5e6f7g8h9i0j...`
   The string after `/folders/` is your `GOOGLE_DRIVE_FOLDER_ID`.

### Step 5: Add Environment Variables in Vercel
In your Vercel Dashboard for `ruel` (**Settings > Environment Variables**), add the following 3 variables:

| Variable Name | Value | Description |
|---|---|---|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | `wedding-moments-uploader@...iam.gserviceaccount.com` | From the downloaded JSON file (`client_email`) |
| `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | `-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n` | From the downloaded JSON file (`private_key`) |
| `GOOGLE_DRIVE_FOLDER_ID` | `1a2b3c4d5e6f7g8h9i0j...` | The ID of your shared folder from Step 4 |

> **Note:** For `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`, copy the exact text including `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----`.

---

## Admin Verification

1. Log in to your Admin Panel at `/admin.html`.
2. Go to the **Settings** tab.
3. The **Google Drive Storage Backup** card will display:
   - Status: **Connected** (with a green badge)
   - A direct button: **Open Google Drive Folder**
   - A **Sync Existing Photos to Drive** button to copy any earlier photos into Drive with one click.
