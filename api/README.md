# AgentQL Integration

This project uses AgentQL for automated receipt/invoice data extraction.

## Setup

1. **API Key**: The AgentQL API key is stored as an environment variable in Vercel:
   - Variable name: `AGENTQL_KEY`
   - Already configured in your Vercel project settings

2. **Serverless Function**: `/api/extract-receipt.js`
   - This function securely calls the AgentQL API
   - Keeps the API key server-side for security
   - Processes receipt images and extracts structured data

## Customizing the Extraction Prompt

The extraction prompt defines what data AgentQL should extract from receipts. 

**Location**: `api/extract-receipt.js` (lines ~25-40)

You can modify the `extractionPrompt` variable to customize what gets extracted:

```javascript
const extractionPrompt = `
  Extract the following information from this receipt/invoice:
  - Total amount (number only, no currency symbols)
  - Date (in YYYY-MM-DD format)
  - Vendor/supplier name
  - Description or main items purchased
  - Line items with quantities and prices if available
  
  Return the data in JSON format with these fields:
  {
    "total_amount": <number>,
    "date": "<YYYY-MM-DD>",
    "vendor": "<string>",
    "description": "<string>",
    "items": [{"name": "<string>", "quantity": <number>, "price": <number>}]
  }
`;
```

### Tips for Customizing the Prompt:

- Be specific about the format you want (e.g., "YYYY-MM-DD" for dates)
- Request structured JSON output for easy parsing
- Add more fields if needed (tax, payment method, invoice number, etc.)
- Specify units (e.g., "amount in USD")
- Ask for specific validation (e.g., "only numeric values for amounts")

## How It Works

1. User uploads a receipt image or captures a screenshot
2. Image is converted to base64
3. Client calls `/api/extract-receipt` with the image data
4. Serverless function sends image + prompt to AgentQL API
5. AgentQL extracts data and returns JSON
6. Data is optionally saved to the expenses table

## Error Handling

- If AgentQL extraction fails, the reorder process still completes
- Users see a notification but the workflow isn't blocked
- Errors are logged to console for debugging
