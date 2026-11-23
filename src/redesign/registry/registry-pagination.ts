export function allPageNumber(
  page: number,
  modPages: number,
  addonPages: number,
) {
  return Math.min(Math.max(page, 1), Math.max(1, modPages, addonPages))
}

export function allPageItems<T>(
  page: number,
  results: {
    mods: { items: T[]; lastPage: number }
    addons: { items: T[]; lastPage: number }
  },
): T[] {
  return [
    ...(page <= results.mods.lastPage ? results.mods.items : []),
    ...(page <= results.addons.lastPage ? results.addons.items : []),
  ]
}
