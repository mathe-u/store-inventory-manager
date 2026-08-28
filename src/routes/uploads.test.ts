import { describe, it, expect, vi, beforeEach } from 'vitest';

// Configurando as variáveis de ambiente antes de qualquer import/execução de módulo
process.env.SUPABASE_URL = 'https://mock-supabase.supabase.co';
process.env.SUPABASE_BUCKET_NAME = 'mock-bucket';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-key';

const mockUpload = vi.fn();
const mockGetPublicUrl = vi.fn();

vi.mock('@supabase/supabase-js', () => {
  return {
    createClient: vi.fn(() => ({
      storage: {
        from: vi.fn(() => ({
          upload: mockUpload,
          getPublicUrl: mockGetPublicUrl,
        })),
      },
    })),
  };
});

import Fastify, { type FastifyInstance } from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import { uploadRoutes } from './uploads.js';

async function buildTestApp() {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(uploadRoutes);
  return app;
}

describe('Upload Routes', () => {
  let app: FastifyInstance;
  const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    app = await buildTestApp();
  });

  const createMultipartBody = (filename: string, mimetype: string, content: string) => {
    return [
      `--${boundary}`,
      `Content-Disposition: form-data; name="file"; filename="${filename}"`,
      `Content-Type: ${mimetype}`,
      '',
      content,
      `--${boundary}--`,
      ''
    ].join('\r\n');
  };

  it('should successfully upload an image and return the public URL', async () => {
    // Mock Supabase storage methods
    mockUpload.mockResolvedValue({ error: null });
    mockGetPublicUrl.mockReturnValue({
      data: { publicUrl: 'https://mock-supabase.supabase.co/storage/v1/object/public/mock-bucket/products/random-uuid.png' }
    });

    const body = createMultipartBody('image.png', 'image/png', 'fake-image-binary-data');

    const response = await app.inject({
      method: 'POST',
      url: '/products',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      imageUrl: 'https://mock-supabase.supabase.co/storage/v1/object/public/mock-bucket/products/random-uuid.png'
    });

    expect(mockUpload).toHaveBeenCalledOnce();
    expect(mockGetPublicUrl).toHaveBeenCalledOnce();
  });

  it('should return 400 when no file is uploaded', async () => {
    const emptyBody = `--${boundary}--`;

    const response = await app.inject({
      method: 'POST',
      url: '/products',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: emptyBody,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ message: 'File not provided' });
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('should return 400 when uploaded file is not an image', async () => {
    const body = createMultipartBody('document.pdf', 'application/pdf', 'fake-pdf-content');

    const response = await app.inject({
      method: 'POST',
      url: '/products',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ message: 'Invalid file type' });
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('should return 500 when Supabase upload fails', async () => {
    const uploadError = new Error('Supabase Storage connection failed');
    mockUpload.mockResolvedValue({ error: uploadError });

    const body = createMultipartBody('image.png', 'image/png', 'fake-image-binary-data');

    const response = await app.inject({
      method: 'POST',
      url: '/products',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });

    expect(response.statusCode).toBe(500);
    expect(response.json().message).toContain('File upload failed');
    expect(mockUpload).toHaveBeenCalledOnce();
  });
});
