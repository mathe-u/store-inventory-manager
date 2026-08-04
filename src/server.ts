import fastify, { type FastifyRequest, type FastifyReply } from 'fastify';
import jwt from '@fastify/jwt';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { authRoutes } from './routes/auth.js';
import { userRoutes } from './routes/users.js';
import { productRoutes } from './routes/products.js';
import { settingsRoutes } from './routes/settings.js';
import { saleRoutes } from './routes/sales.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { categoryRoutes } from './routes/categories.js';
import { pricingRoutes } from './routes/pricing.js';
import { paymentRoutes } from './routes/payments.js';
import { uploadRoutes } from './routes/uploads.js';
import { prisma } from './lib/prisma.js';

const app = fastify().withTypeProvider<ZodTypeProvider>();

const port = 3333

app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);

app.register(cors, {
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
});

app.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
});

app.register(jwt, {
  secret: process.env.JWT_SECRET || 'super-secret-key-fallback',
});

// Middleware for authentication
app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    await request.jwtVerify();

    const authHeader = request.headers.authorization;
    if (!authHeader) {
      return reply.status(400).send({ message: 'Missing token' });
    }
    const token = authHeader.replace('Bearer ', '');

    const isRevoked = await prisma.revokedToken.findUnique({ where: { token } });
    if (isRevoked) {
      return reply.status(401).send({ message: 'Token Revoked' });
    }

  } catch (err) {
    return reply.status(401).send({ message: 'Unauthorized', error: err });
  }
});

// app.register(fastifySwagger, {
//   openapi: {
//     info: {
//       title: 'Webhook Inspector API',
//       description: 'API for',
//       version: '1.0.0',
//     }
//   }, 
//   transform: jsonSchemaTransform,
// })
// app.register(ScalarApiReference, {
//   routePrefixx: '/api/v1/docs',
// })

app.register(authRoutes, { prefix: '/api/v1/auth' });
app.register(userRoutes, { prefix: '/api/v1/users' });
app.register(productRoutes, { prefix: '/api/v1/products' });
app.register(uploadRoutes, { prefix: '/api/v1/upload' });
app.register(settingsRoutes, { prefix: '/api/v1/settings' });
app.register(saleRoutes, { prefix: '/api/v1/sales' });
app.register(dashboardRoutes, { prefix: '/api/v1/dashboard' });
app.register(categoryRoutes, { prefix: '/api/v1/categories' });
app.register(pricingRoutes, { prefix: '/api/v1/pricing' });
app.register(paymentRoutes, { prefix: '/api/v1/payments' });

app.listen({ port: port, host: '0.0.0.0' })
  .catch(error => {
    console.log(`Error: ${error}`)
    process.exit(1)
  }).then(() => {
    console.log(`HTTP Server Running on http://localhost:${port}`);
    console.log(`Docs available at http://localhost:${port}/api/v1/docs`);
  });
