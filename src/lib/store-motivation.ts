export function isRetailStoreForMotivation(storeName: string): boolean {
  return !/склад|warehouse/i.test(storeName);
}
