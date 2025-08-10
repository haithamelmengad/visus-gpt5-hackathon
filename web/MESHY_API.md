# Meshy API Integration

This document describes the Meshy text-to-3D API integration in the Visus application, including the complete workflow from preview generation to final refinement.

## Overview

The Meshy API integration provides a two-stage 3D generation process:
1. **Preview Mode**: Fast, low-quality initial generation for concept validation
2. **Refine Mode**: High-quality final generation based on the preview

## API Endpoints

### 1. Start Generation (`POST /api/visualizer/meshy/start`)

Initiates either a preview or refine generation.

**Request Body:**
```typescript
// Preview Mode (default)
{
  "prompt": "Drake — crown chrome",
  "mode": "preview" // optional, defaults to "preview"
}

// Refine Mode
{
  "prompt": "Drake — crown chrome", // optional override
  "mode": "refine",
  "previewId": "preview-generation-id-here"
}
```

**Response:**
```typescript
{
  "id": "generation-id",
  "mode": "preview" | "refine",
  "previewId": "preview-id" // only for refine mode
}
```

### 2. Refine Generation (`POST /api/visualizer/meshy/refine`)

Dedicated endpoint for refinement requests.

**Request Body:**
```typescript
{
  "previewId": "preview-generation-id",
  "prompt": "Drake — crown chrome", // optional override
  "enablePbr": true, // optional, defaults to true
  "topology": "triangle" // optional, "triangle" | "quad", defaults to "triangle"
}
```

**Response:**
```typescript
{
  "id": "refinement-generation-id",
  "previewId": "preview-generation-id",
  "mode": "refine"
}
```

### 3. Check Status (`GET /api/visualizer/meshy/status?id=<generation-id>`)

Poll the status of any generation (preview or refine).

**Response:**
```typescript
{
  "status": "pending" | "processing" | "completed" | "failed",
  "model_urls": {
    "glb": "https://assets.meshy.ai/...",
    "gltf": "https://assets.meshy.ai/...",
    "mtl": "https://assets.meshy.ai/..."
  },
  "metadata": {
    "prompt": "Drake — crown chrome",
    "art_style": "realistic",
    "texture_richness": "high"
  }
}
```

### 4. Fetch Model (`GET /api/visualizer/meshy/fetch?url=<encoded-url>`)

Proxies Meshy asset URLs to avoid CORS issues.

## Complete Workflow

### Step 1: Generate Preview
```bash
curl -X POST http://localhost:3000/api/visualizer/meshy/start \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Drake — crown chrome"}'
```

Response: `{"id": "preview-123", "mode": "preview"}`

### Step 2: Poll Preview Status
```bash
curl "http://localhost:3000/api/visualizer/meshy/status?id=preview-123"
```

Repeat until status is "completed".

### Step 3: Request Refinement
```bash
curl -X POST http://localhost:3000/api/visualizer/meshy/refine \
  -H "Content-Type: application/json" \
  -d '{"previewId": "preview-123"}'
```

Response: `{"id": "refine-456", "previewId": "preview-123", "mode": "refine"}`

### Step 4: Poll Refinement Status
```bash
curl "http://localhost:3000/api/visualizer/meshy/status?id=refine-456"
```

Repeat until status is "completed".

### Step 5: Download Final Model
```bash
curl "http://localhost:3000/api/visualizer/meshy/fetch?url=<encoded-model-url>"
```

## Environment Variables

```bash
# Required
MESHY_API_KEY=your_meshy_api_key_here

# Optional (with defaults)
MESHY_START_CACHE_TTL_MS=300000        # 5 minutes
MESHY_REFINE_CACHE_TTL_MS=600000       # 10 minutes
MESHY_STATUS_CACHE_TTL_MS=15000        # 15 seconds
MESHY_PREVIEW_CACHE_TTL_MS=86400000    # 24 hours
MESHY_REFINEMENT_CACHE_TTL_MS=86400000 # 24 hours
MESHY_MODEL_URL_TTL_MS=604800000       # 7 days
```

## Caching Strategy

- **Preview/Refine requests**: Cached to avoid duplicate API calls
- **Status checks**: Short TTL for real-time updates
- **Generated prompts**: Long TTL for consistency across sessions
- **Model URLs**: Long TTL for completed generations

## Error Handling

The API includes comprehensive error handling:
- Missing API keys
- Invalid request parameters
- Meshy API errors
- Network failures
- Response parsing errors

## Performance Considerations

- **Preview mode**: Fast generation (~30 seconds) for concept validation
- **Refine mode**: Higher quality but longer generation time (~2-5 minutes)
- **Caching**: Reduces API calls and improves response times
- **Background processing**: All generations are asynchronous

## Best Practices

1. **Always start with preview mode** to validate your prompt
2. **Use descriptive, specific prompts** for better results
3. **Poll status endpoints** with reasonable intervals (15-30 seconds)
4. **Cache generation IDs** to avoid losing track of requests
5. **Handle errors gracefully** and provide user feedback

## Example Client Implementation

```typescript
async function generate3DModel(prompt: string) {
  // Step 1: Start preview
  const previewResponse = await fetch('/api/visualizer/meshy/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, mode: 'preview' })
  });
  const { id: previewId } = await previewResponse.json();
  
  // Step 2: Wait for preview completion
  const previewModel = await waitForCompletion(previewId);
  
  // Step 3: Request refinement
  const refineResponse = await fetch('/api/visualizer/meshy/refine', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ previewId })
  });
  const { id: refineId } = await refineResponse.json();
  
  // Step 4: Wait for refinement completion
  const finalModel = await waitForCompletion(refineId);
  
  return finalModel;
}

async function waitForCompletion(generationId: string) {
  while (true) {
    const statusResponse = await fetch(`/api/visualizer/meshy/status?id=${generationId}`);
    const status = await statusResponse.json();
    
    if (status.status === 'completed') {
      return status;
    } else if (status.status === 'failed') {
      throw new Error('Generation failed');
    }
    
    // Wait before next poll
    await new Promise(resolve => setTimeout(resolve, 15000));
  }
}
```

## Troubleshooting

### Common Issues

1. **Missing API Key**: Ensure `MESHY_API_KEY` is set in your environment
2. **Invalid Preview ID**: Make sure the preview generation completed before refining
3. **CORS Issues**: Use the `/fetch` endpoint to proxy Meshy assets
4. **Rate Limiting**: Implement exponential backoff for status polling

### Debug Logging

All endpoints include comprehensive logging with `[MESHY *]` prefixes. Check your server logs for detailed information about API calls and responses.
