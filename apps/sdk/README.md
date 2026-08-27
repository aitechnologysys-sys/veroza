# Postaryx NodeJS SDK

This is the NodeJS SDK for Postaryx.

You can start by installing the package:

```bash
npm install @postaryx/node
```

## Usage
```typescript
import Postaryx from '@postaryx/node';
const postaryx = new Postaryx('your api key');

// Optional: point the SDK at a self-hosted Postaryx instance.
const selfHosted = new Postaryx('your api key', 'https://app.example.com');
```

The available methods are:
- `post(posts: CreatePostDto)` - Schedule a post to Postaryx
- `postList(filters: GetPostsDto)` - Get a list of posts
- `upload(file: Buffer, extension: string)` - Upload a file to Postaryx
- `integrations()` - Get a list of connected channels
- `deletePost(id: string)` - Delete a post by ID

By default the SDK talks to `https://api.postaryx.com`. To use a self-hosted
deployment, pass your own base URL as the second constructor argument or set
`POSTARYX_API_URL` in the environment.
