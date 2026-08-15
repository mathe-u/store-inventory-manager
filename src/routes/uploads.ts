import { type FastifyInstance } from "fastify";
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { fastifyMultipart } from "@fastify/multipart";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import path from "path";
import { z } from "zod";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseBucket = process.env.SUPABASE_BUCKET_NAME!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function uploadRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  app.register(fastifyMultipart, {
    limits: {fileSize: 2 * 1024 * 1024}
  });

  app.post('/products', {
    schema: {
      tags: ['Uploads'],
      summary: 'Upload de imagem de produto',
      description: 'Aceita multipart/form-data com um campo de arquivo de imagem (máx 2MB). Retorna a URL pública da imagem no Supabase Storage.',
      security: [{ BearerAuth: [] }],
      consumes: ['multipart/form-data'],
      response: {
        200: z.object({ imageUrl: z.string() }),
        400: z.object({ message: z.string() }),
        500: z.object({ message: z.string() }),
      },
    },
  }, async (request, reply) => {
    const data = await request.file();
    
    if (!data) {
        return reply.status(400).send({ message: 'File not provided' });
    }

    if (!data.mimetype.startsWith('image/')) {
        return reply.status(400).send({ message: 'Invalid file type' });
    }

    try {
        const fileBuffer = await data.toBuffer();
        const fileExtension = path.extname(data.filename).toLowerCase();
        const fileName = `${randomUUID()}${fileExtension}`;
        const filePath = `products/${fileName}`;

        const { error: uploadError } = await supabase.storage
            .from(supabaseBucket)
            .upload(filePath, fileBuffer, {
                contentType: data.mimetype,
                upsert: true,
            });
        
        if (uploadError) {
            throw uploadError;
        }

        const { data: { publicUrl } } = supabase.storage
            .from(supabaseBucket)
            .getPublicUrl(filePath);
        
        return { imageUrl: publicUrl };

    } catch (err) {
        console.error(err);
        return reply.status(500).send({ message: `File upload failed: ${err}` });
    }
  });

}