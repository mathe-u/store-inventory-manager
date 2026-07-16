import { type FastifyInstance } from "fastify";
import { fastifyMultipart } from "@fastify/multipart";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import path from "path";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseBucket = process.env.SUPABASE_BUCKET_NAME!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function uploadRoutes(app: FastifyInstance) {
  app.register(fastifyMultipart, {
    limits: {fileSize: 2 * 1024 * 1024}
  });

  app.post('/products', async (request, reply) => {
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

        const { data: uploadResult, error: uploadError } = await supabase.storage
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