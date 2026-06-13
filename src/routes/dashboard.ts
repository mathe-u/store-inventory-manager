import { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

export async function dashboardRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/stats', async () => {
    const sales = await prisma.sale.findMany({
      orderBy: { createdAt: 'desc' },
    });

    const totalRevenue = sales.reduce((acc, sale) => acc + (sale.finalPrice * sale.quantity), 0 as number);
    const totalProfit = sales.reduce((acc, sale) => acc + sale.calculatedProfit, 0 as number);

    // Group by month
    const monthlyStats: Record<string, { revenue: number; profit: number }> = {};
    sales.forEach((sale: any) => {
      const month = sale.createdAt.toISOString().slice(0, 7); // YYYY-MM
      if (!monthlyStats[month]) {
        monthlyStats[month] = { revenue: 0, profit: 0 };
      }
      monthlyStats[month].revenue += sale.finalPrice * sale.quantity;
      monthlyStats[month].profit += sale.calculatedProfit;
    });

    // Top selling products
    const productSales: Record<string, { name: string; quantity: number }> = {};
    const salesWithProduct = await prisma.sale.findMany({
      where: { status: 'COMPLETED' },
      include: { product: true }
    });

    salesWithProduct.forEach((sale: any) => {
      const id = sale.productId;
      if (!productSales[id]) {
        productSales[id] = { name: sale.product.name, quantity: 0 };
      }
      productSales[id].quantity += sale.quantity;
    });

    const topSelling = Object.values(productSales)
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5);

    return {
      totalRevenue,
      totalProfit,
      monthlyStats: Object.entries(monthlyStats).map(([month, data]) => ({ month, ...data })),
      topSelling,
    };
  });

  app.get('/price-evolution/:productId', async (request) => {
    const paramsSchema = z.object({ productId: z.string().uuid() });
    const { productId } = paramsSchema.parse(request.params);

    const sales = await prisma.sale.findMany({
      where: { productId, status: 'COMPLETED' },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true, finalPrice: true },
    });

    return sales;
  });
}
