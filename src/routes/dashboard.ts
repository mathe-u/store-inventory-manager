import { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
// import type { Category } from '../generated/prisma/index.js';

export async function dashboardRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/stats', async (request) => {
    const querySchema = z.object({
      days: z.coerce.number().positive().optional()
    });

    const { days } = querySchema.parse(request.query);

    let dateFilter = {};
    if (days) {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      dateFilter = { createdAt: { gte: startDate } };
    }

    const sales = await prisma.sale.findMany({
      where: dateFilter,
      orderBy: { createdAt: 'desc' },
    });

    const grossRevenue = sales.reduce((acc, sale) => acc + (sale.finalPrice * sale.quantity), 0 as number);

    const grossRevenueDelta = 0.05;

    const netRevenue = sales.filter(sale => sale.status === 'COMPLETED').reduce((acc, sale) => acc + (sale.finalPrice * sale.quantity), 0);

    const grossProfit = 0;

    const netProfit = sales.reduce((acc, sale) => acc + sale.calculatedProfit, 0 as number);

    const netProfitDelta = 0.03;

    const totalOrders = sales.length;

    const totalOrdersDelta = 0.04;

    // Group by month
    // grafico de barras duplas (faturamento bruto, custos) ao longo do tempo (mes)
    const monthlyStats: Record<string, { grossRevenue: number; costs: number }> = {};

    sales.forEach((sale) => {
      const date = sale.createdAt.toISOString().slice(0, 7); // YYYY-MM
      if (!monthlyStats[date]) {
        monthlyStats[date] = { grossRevenue: 0, costs: 0 };
      }

      monthlyStats[date].grossRevenue += sale.finalPrice * sale.quantity;
      monthlyStats[date].costs += 2 * sale.quantity;
    });

    // Top selling products
    const productSales: Record<string, { productId: string; name: string; category: string | null; quantity: number }> = {};
    const salesWithProduct = await prisma.sale.findMany({
      where: { status: 'COMPLETED'
        ,
        ...dateFilter,
        },
      include: { product: { include: { category: true } } }
    });

    for (const sale of salesWithProduct) {
      const id = sale.productId;
      const category = sale.product.category;

      if (!productSales[id]) {
        productSales[id] = { productId: sale.productId, name: sale.product.name, category: category?.name ?? null, quantity: 0 };
      }
      productSales[id].quantity += sale.quantity;
    }

    const topSelling = Object.values(productSales)
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5);

    return {
      grossRevenue,
      grossRevenueDelta,
      netRevenue,
      grossProfit,
      netProfit,
      netProfitDelta,
      totalOrders,
      totalOrdersDelta,
      monthlyStats: Object.entries(monthlyStats).map(([date, data]) => ({ date, ...data })),
      topSelling,
    };
  });

  app.get('/price-evolution/:productId', async (request) => {
    // TODO: tratar dias que nao houver nunhuma venda
    const paramsSchema = z.object({ productId: z.uuid() });
    const querySchema = z.object({ days: z.coerce.number().positive().optional() });

    const { productId } = paramsSchema.parse(request.params);
    const { days } = querySchema.parse(request.query);

    let dateFilter = {};
  if (days) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    dateFilter = { createdAt: { gte: startDate } };
  }

    const sales = await prisma.sale.findMany({
      where: { productId, status: 'COMPLETED', ...dateFilter },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true, finalPrice: true },
    });

    const dailyPriceMap: Record<string, {date: string; sumPrice: number; count: number }> = {};

    sales.forEach((sale) => {
      const dateStr = sale.createdAt.toISOString().slice(0, 10);

      if (!dailyPriceMap[dateStr]) {
        dailyPriceMap[dateStr] = { date: dateStr, sumPrice: 0, count: 0 };
      }

      dailyPriceMap[dateStr].sumPrice += sale.finalPrice;
      dailyPriceMap[dateStr].count += 1;
    });

    const timeSeries = Object.values(dailyPriceMap).map((day) => ({
      date: day.date,
      price: Number((day.sumPrice / day.count).toFixed(2)),
    }));

    return timeSeries;
  });
}
