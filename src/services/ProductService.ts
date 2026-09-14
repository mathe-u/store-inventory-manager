import { prisma } from "../lib/prisma.js";
import type { Prisma } from "../generated/prisma/client.js";

interface ListProductInput {
    page: number;
    limit: number;
    search?: string;
    categoryId?: string;
    orderBy?: 'name' | 'createdAt' | 'stockQuantity';
    order?: 'asc' | 'desc';
}

export class ProductService {
    static async list(
        {
            page,
            limit,
            search,
            categoryId,
            orderBy = 'createdAt',
            order = 'desc',
        }: ListProductInput) {
        const where: Prisma.ProductWhereInput = {};

        if (search) {
            where.OR = [
                { name: { contains: search } },
                { category: { name: { contains: search } } },
            ];
        }

        if (categoryId) {
            where.categoryId = categoryId;
        }

        const skip = (page - 1) * limit;

        const [products, total] = await Promise.all([
            prisma.product.findMany({
                where,
                skip,
                take: limit,
                orderBy: { [orderBy]: order },
                include: { category: true },
            }),
            prisma.product.count({ where })
        ]);

        return {
            products,
            meta: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        };
    }
}