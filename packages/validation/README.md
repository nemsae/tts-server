# @nemsae/tts-validation

Shared Zod schemas and inferred types for the Tone TTS server and UI.

## Install

```bash
npm install @nemsae/tts-validation zod
```

## Usage

```ts
import { CreateRoomSchema } from '@nemsae/tts-validation';

const result = CreateRoomSchema.safeParse(formValues);

if (!result.success) {
  console.log(result.error.flatten());
}
```

## Publishing

This package is published from the main server repo via the `Publish Validation Package` GitHub Actions workflow.
