#!/bin/bash

# GCP Deployment Script for TTS Server
# Replace these variables with your values
PROJECT_ID="project-id"  # Replace with your GCP project ID
REGION="us-central1"          # Change if you prefer a different region
SERVICE_NAME="tts-server"
CLIENT_URL="client-url"  # Replace with your frontend URL

if [ -f .env ]; then
    source .env
    OPENAI_KEY=$OPENAI_API_KEY
    REGION=$REGION
    SERVICE_NAME=$SERVICE_NAME
    CLIENT_URL=$CLIENT_URL
    PROJECT_ID=$PROJECT_ID
else
    echo -e "${YELLOW}Warning: .env file not found. Please set the required environment variables.${NC}"
fi

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}Starting GCP deployment for TTS Server...${NC}"

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo -e "${RED}Error: gcloud CLI is not installed.${NC}"
    echo "Please install Google Cloud SDK: https://cloud.google.com/sdk/docs/install"
    exit 1
fi

# Check if user is authenticated
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" &> /dev/null; then
    echo -e "${YELLOW}You need to authenticate with GCP.${NC}"
    gcloud auth login
fi

# Set the project
echo -e "${GREEN}Setting project to: ${PROJECT_ID}${NC}"
gcloud config set project $PROJECT_ID

# Enable required APIs
echo -e "${GREEN}Enabling required APIs...${NC}"
gcloud services enable run.googleapis.com
gcloud services enable cloudbuild.googleapis.com
gcloud services enable secretmanager.googleapis.com

# Create secrets
echo -e "${GREEN}Creating secrets in Secret Manager...${NC}"

# Create secret for OpenAI API key
if ! gcloud secrets describe openai-api-key &> /dev/null; then
    printf '%s' "$OPENAI_KEY" | gcloud secrets create openai-api-key --data-file=-
    echo -e "${GREEN}Created openai-api-key secret${NC}"
else
    printf '%s' "$OPENAI_KEY" | gcloud secrets versions add openai-api-key --data-file=-
    echo -e "${GREEN}Updated openai-api-key secret${NC}"
fi

# Create secret for frontend URL
if ! gcloud secrets describe client-url &> /dev/null; then
    printf '%s' "$CLIENT_URL" | gcloud secrets create client-url --data-file=-
    echo -e "${GREEN}Created client-url secret${NC}"
else
    printf '%s' "$CLIENT_URL" | gcloud secrets versions add client-url --data-file=-
    echo -e "${GREEN}Updated client-url secret${NC}"
fi

# Build and push the container
echo -e "${GREEN}Building and pushing container image...${NC}"
IMAGE_TAG="gcr.io/${PROJECT_ID}/${SERVICE_NAME}:latest"
gcloud builds submit --tag $IMAGE_TAG .

# Deploy to Cloud Run
echo -e "${GREEN}Deploying to Cloud Run...${NC}"
gcloud run deploy $SERVICE_NAME \
  --image=$IMAGE_TAG \
  --region=$REGION \
  --platform=managed \
  --allow-unauthenticated \
  --port=8080 \
  --timeout=3600 \
  --session-affinity \
  --min-instances=1 \
  --max-instances=10 \
  --memory=512Mi \
  --cpu=1 \
  --set-secrets="OPENAI_API_KEY=openai-api-key:latest,CLIENT_URL=client-url:latest"

# Get the service URL
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --region=$REGION --format="value(status.url)")

echo -e "${GREEN}Deployment complete!${NC}"
echo -e "Your service is available at: ${YELLOW}${SERVICE_URL}${NC}"
echo -e "Update your frontend to connect to: ${YELLOW}${SERVICE_URL}${NC}"

# Test the deployment
echo -e "${GREEN}Testing deployment...${NC}"
curl -s -o /dev/null -w "%{http_code}" $SERVICE_URL || echo "Service might still be starting up..."

echo -e "\n${GREEN}Deployment script completed!${NC}"