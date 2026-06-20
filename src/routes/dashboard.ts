import { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

export async function dashboardRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/stats', async () => {
    const sales = await prisma.sale.findMany({
      orderBy: { createdAt: 'desc' },
    });

    const grossRevenue = sales.reduce((acc, sale) => acc + (sale.finalPrice * sale.quantity), 0 as number);

    const netRevenue = sales.filter(sale => sale.status === 'COMPLETED').reduce((acc, sale) => acc + (sale.finalPrice * sale.quantity), 0);

    const grossProfit = 0;

    const netProfit = sales.reduce((acc, sale) => acc + sale.calculatedProfit, 0 as number);

    const totalOrders = 0;

    // Group by month
    // grafico de barras duplas (faturamento bruto, custos) ao longo do tempo (mes)
    const monthlyStats: Record<string, { grossRevenue: number; netRevenue: number; netProfit: number }> = {};

    sales.forEach((sale) => {
      const month = sale.createdAt.toISOString().slice(0, 7); // YYYY-MM
      if (!monthlyStats[month]) {
        monthlyStats[month] = { grossRevenue: 0, netRevenue: 0, netProfit: 0 };
      }

      const saleValue = sale.finalPrice * sale.quantity;

      if (sale.status == 'COMPLETED') {
        monthlyStats[month].netRevenue += saleValue;
      }

      monthlyStats[month].netProfit += sale.calculatedProfit;
    });

    // Top selling products
    const productSales: Record<string, { name: string; category: string; quantity: number }> = {};
    const salesWithProduct = await prisma.sale.findMany({
      where: { status: 'COMPLETED' },
      include: { product: true }
    });

    salesWithProduct.forEach((sale) => {
      const id = sale.productId;
      if (!productSales[id]) {
        productSales[id] = { name: sale.product.name, category: '', quantity: 0 };
      }
      productSales[id].quantity += sale.quantity;
    });

    const topSelling = Object.values(productSales)
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5);

    return {
      grossRevenue,
      netRevenue,
      grossProfit,
      netProfit,
      totalOrders,
      monthlyStats: Object.entries(monthlyStats).map(([month, data]) => ({ month, ...data })),
      topSelling,
    };
  });

  app.get('/price-evolution/:productId', async (request) => {
    // TODO: tratar dias que nao houver nunhuma venda
    const paramsSchema = z.object({ productId: z.uuid() });
    const { productId } = paramsSchema.parse(request.params);

    const sales = await prisma.sale.findMany({
      where: { productId, status: 'COMPLETED' },
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
