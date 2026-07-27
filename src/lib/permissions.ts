// ─── Permission keys ───────────────────────────────────────────
// Cada ação protegida do sistema tem uma chave.
// Para adicionar novas permissões, basta criar novas chaves aqui.
export const Permission = {
    // Categories
    CATEGORY_CREATE: 'category:create',
    CATEGORY_UPDATE: 'category:update',
    CATEGORY_DELETE: 'category:delete',

    // Products (exemplo para o futuro)
    PRODUCT_CREATE: 'product:create',
    PRODUCT_UPDATE: 'product:update',
    PRODUCT_DELETE: 'product:delete',

    // Sales
    SALE_CREATE: 'sale:create',
    SALE_UPDATE: 'sale:update',
    SALE_DELETE: 'sale:delete',

    // Settings
    SETTINGS_UPDATE: 'settings:update',
} as const;

export type PermissionKey = (typeof Permission)[keyof typeof Permission];

// ─── Role → Permissions map ────────────────────────────────────
// Para adicionar uma nova role (ex: "manager"), basta adicionar
// uma nova entrada aqui. NADA MAIS precisa mudar.
const rolePermissions: Record<string, Set<PermissionKey>> = {
    ADMIN: new Set(Object.values(Permission)), // admin pode tudo

    SELLER: new Set([
        // Seller pode gerenciar produtos e vendas, mas NÃO categorias
        Permission.PRODUCT_CREATE,
        Permission.PRODUCT_UPDATE,
        Permission.PRODUCT_DELETE,
        Permission.SALE_CREATE,
        Permission.SALE_UPDATE,
        Permission.SALE_DELETE,
    ]),
};

// ─── Helper ────────────────────────────────────────────────────
export function hasPermission(role: string, permission: PermissionKey): boolean {
    const perms = rolePermissions[role];
    if (!perms) return false;
    return perms.has(permission);
}
