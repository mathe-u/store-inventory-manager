-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "GlobalSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "hourlyRate" REAL NOT NULL DEFAULT 0,
    "defaultTaxRate" REAL NOT NULL DEFAULT 0,
    "fixedMonthlyCosts" REAL NOT NULL DEFAULT 0,
    "variableMonthlyCosts" REAL NOT NULL DEFAULT 0,
    "investmentRate" REAL NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "imageUrl" TEXT,
    "stockQuantity" INTEGER NOT NULL DEFAULT 0,
    "minStockAlert" INTEGER NOT NULL DEFAULT 5,
    "metadata" TEXT NOT NULL,
    "acquisitionCost" REAL NOT NULL DEFAULT 0,
    "shippingCost" REAL NOT NULL DEFAULT 0,
    "taxRate" REAL NOT NULL DEFAULT 0,
    "directCosts" REAL NOT NULL DEFAULT 0,
    "timeSpent" REAL NOT NULL DEFAULT 0,
    "lossIndex" REAL NOT NULL DEFAULT 0,
    "desiredMargin" REAL NOT NULL DEFAULT 30,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Sale" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "finalPrice" REAL NOT NULL,
    "calculatedProfit" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Sale_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
