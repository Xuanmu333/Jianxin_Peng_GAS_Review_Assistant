#!/bin/sh
set -eu

CLOUD_PROJECT="${GOOGLE_CLOUD_PROJECT:-pdc-digital-system}"
CLOUD_REGION="${GOOGLE_CLOUD_REGION:-asia-east1}"
CLOUD_SERVICE="${CLOUD_RUN_SERVICE:-issues-management}"
CLOUD_SERVICE_ACCOUNT="${CLOUD_RUN_SERVICE_ACCOUNT:-pdc-digital-system@pdc-digital-system.iam.gserviceaccount.com}"
SHEET_ID="${REVIEW_SPREADSHEET_ID:-1py3sy7Cf2HCTxdhrRhFGoYzrnLRomOrNrTJU7KrGKUE}"

gcloud run deploy "$CLOUD_SERVICE" \
  --source . \
  --project "$CLOUD_PROJECT" \
  --region "$CLOUD_REGION" \
  --service-account "$CLOUD_SERVICE_ACCOUNT" \
  --update-env-vars "REVIEW_SPREADSHEET_ID=$SHEET_ID,ISSUES_SHEET_NAME=Issues,QUESTIONS_SHEET_NAME=Questions,ACCESS_REQUESTS_SHEET_NAME=AccessRequests" \
  --allow-unauthenticated
