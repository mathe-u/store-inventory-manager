# Store Inventory Manager API

This is a fastify-based API for managing store inventory.

## Requirements

- **Node.js** 24.05.0
- **Typescript** 
- **Fastify**
- **Prisma**
- **Zod**
- **Bcrypt**
- **Fastify Jwt**
- **Fastify Cors**
- **Eslint**
- **Prettier**

## Instructions

```bash
# Install dependencies
npm install

# Generate Prisma client
npx prisma generate

# Start server
npm run dev
```

## Useful Commands

```bash
# Run Prisma migrations
npx prisma migrate dev

# Run Prisma generate
npx prisma generate

# Run Prisma studio
npx prisma studio
```

## API Structure

```bash
/api/v1
├── auth
│   ├── register
│   └── login
├── products
│   ├── [id]
│   ├── [id]
│   ├── [id]
│   └── [id]
├── settings
│   ├── [id]
│   ├── [id]
│   ├── [id]
│   └── [id]
├── sales
│   ├── [id]
│   ├── [id]
│   ├── [id]
│   └── [id]
└── dashboard
    ├── [id]
    ├── [id]
    ├── [id]
    └── [id]
```
