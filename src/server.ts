import fastify, { type FastifyRequest, type FastifyReply } from 'fastify';
import jwt from '@fastify/jwt';
import cors from '@fastify/cors';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { authRoutes } from './routes/auth.js';
import { productRoutes } from './routes/products.js';
import { settingsRoutes } from './routes/settings.js';
import { saleRoutes } from './routes/sales.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { categoryRoutes } from './routes/categories.js';

const app = fastify().withTypeProvider<ZodTypeProvider>();

const port = 3333

app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);

app.register(cors, {
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
});

app.register(jwt, {
  secret: process.env.JWT_SECRET || 'super-secret-key-fallback',
});

// Middleware for authentication
app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    await request.jwtVerify();
  } catch (err) {
    reply.send(err);
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
app.register(productRoutes, { prefix: '/api/v1/products' });
app.register(settingsRoutes, { prefix: '/api/v1/settings' });
app.register(saleRoutes, { prefix: '/api/v1/sales' });
app.register(dashboardRoutes, { prefix: '/api/v1/dashboard' });
app.register(categoryRoutes, { prefix: '/api/v1/categories' });

app.listen({ port: port, host: '0.0.0.0' })
  .catch(error => {
    console.log(`Error: ${error}`)
    process.exit(1)
  }).then(() => {
    console.log(`HTTP Server Running on http://localhost:${port}`);
    console.log(`Docs available at http://localhost:${port}/api/v1/docs`);
  });
