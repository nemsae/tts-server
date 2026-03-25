# GCP Cloud Run Deployment Guide

## Prerequisites

1. **Install Google Cloud SDK**: https://cloud.google.com/sdk/docs/install
2. **Install Docker**: https://docs.docker.com/get-docker/
3. **GCP Project with billing enabled**

## Quick Deployment

### 1. Update Configuration

Edit `deploy-to-gcp.sh` and replace:
- `PROJECT_ID="YOUR_PROJECT_ID"` - Your GCP project ID
- `FRONTEND_URL="http://localhost:5173"` - Your frontend URL

### 2. Authenticate with GCP

```bash
gcloud auth login
```

### 3. Run Deployment Script

```bash
./deploy-to-gcp.sh
```

## Manual Deployment Steps

If you prefer manual deployment:

### 1. Set Project

```bash
gcloud config set project YOUR_PROJECT_ID
```

### 2. Enable APIs

```bash
gcloud services enable run.googleapis.com
gcloud services enable cloudbuild.googleapis.com
gcloud services enable secretmanager.googleapis.com
```

### 3. Create Secrets

```bash
# Store OpenAI API key
echo -n "sk-proj-your-openai-api-key" | gcloud secrets create openai-api-key --data-file=-

# Store frontend URL
echo -n "http://localhost:5173" | gcloud secrets create client-url --data-file=-
```

### 4. Build and Deploy

```bash
# Build container
gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/tts-server

# Deploy to Cloud Run
gcloud run deploy tts-server \
  --image=gcr.io/YOUR_PROJECT_ID/tts-server \
  --region=us-central1 \
  --platform=managed \
  --allow-unauthenticated \
  --port=8080 \
  --timeout=3600 \
  --session-affinity \
  --min-instances=1 \
  --max-instances=10 \
  --memory=512Mi \
  --cpu=1 \
  --set-secrets="OPENAI_API_KEY=openai-api-key:latest,CLIENT_URL=client-url:latest" \
  --set-env-vars="PORT=8080"
```

### 5. Get Service URL

```bash
gcloud run services describe tts-server --region=us-central1 --format="value(status.url)"
```

## Important Settings for Socket.io

- `--session-affinity`: Essential for WebSocket connections
- `--timeout=3600`: Allows long-lived WebSocket connections
- `--min-instances=1`: Keeps instance warm to avoid cold starts

## Troubleshooting

### Check Logs

```bash
gcloud run services logs read tts-server --region=us-central1
```

### Update Secrets

```bash
# Update OpenAI API key
echo -n "new-key" | gcloud secrets versions add openai-api-key --data-file=-

# Update frontend URL
echo -n "https://your-production-url.com" | gcloud secrets versions add client-url --data-file=-
```

### Update Service

```bash
gcloud run services update tts-server \
  --update-secrets="OPENAI_API_KEY=openai-api-key:latest,CLIENT_URL=client-url:latest" \
  --region=us-central1
```

## Cost Estimation

- Cloud Run: ~$5-20/month for moderate traffic
- Cloud Build: ~$0-5/month (free tier available)
- Secret Manager: ~$0.06/month