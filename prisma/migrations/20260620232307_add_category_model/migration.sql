-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT '#6750A4',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "imageUrl" TEXT,
    "stockQuantity" INTEGER NOT NULL DEFAULT 0,
    "minStockAlert" INTEGER NOT NULL DEFAULT 5,
    "metadata" TEXT NOT NULL,
    "categoryId" TEXT,
    "acquisitionCost" REAL NOT NULL DEFAULT 0,
    "shippingCost" REAL NOT NULL DEFAULT 0,
    "taxRate" REAL NOT NULL DEFAULT 0,
    "directCosts" REAL NOT NULL DEFAULT 0,
    "timeSpent" REAL NOT NULL DEFAULT 0,
    "lossIndex" REAL NOT NULL DEFAULT 0,
    "desiredMargin" REAL NOT NULL DEFAULT 0.30,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Product" ("acquisitionCost", "createdAt", "desiredMargin", "directCosts", "id", "imageUrl", "lossIndex", "metadata", "minStockAlert", "name", "shippingCost", "stockQuantity", "taxRate", "timeSpent", "updatedAt") SELECT "acquisitionCost", "createdAt", "desiredMargin", "directCosts", "id", "imageUrl", "lossIndex", "metadata", "minStockAlert", "name", "shippingCost", "stockQuantity", "taxRate", "timeSpent", "updatedAt" FROM "Product";
DROP TABLE "Product";
ALTER TABLE "new_Product" RENAME TO "Product";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Category_name_key" ON "Category"("name");
