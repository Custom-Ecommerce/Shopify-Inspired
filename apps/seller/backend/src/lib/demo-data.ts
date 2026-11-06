import { prepareProductVariants } from '@/lib/product-variants';
import { Category, Product, Store } from '@/lib/services';

const DEMO_CATEGORY = { name: 'Demo category', slug: 'demo-category', order: 0 };

const DEMO_PRODUCT = {
  title: 'Demo product',
  slug: 'demo-product',
  description: 'This is a sample product. Edit it to make it your own, or delete it and add your first product.',
  highlights: [{ text: 'Replace this with what makes your product special' }],
};

const DEMO_VARIANT = { price: 1500, stockQuantity: 10 };

/**
 * Seeds one demo category and one demo draft product into a new store (D-016). store.demoSeeded is claimed first, in
 * one conditional write, so a store is seeded once however often this runs, and never again after the seller deletes
 * the demo items.
 *
 * It writes through the models: the `system` actor has no policy rows, and nothing here comes from a client.
 *
 * It never throws: a store without demo data is still a working store. A failure removes what was written, logs it and
 * gives the claim back, so demoSeeded stays false.
 */
export async function seedStoreDemoData(storeId: string): Promise<void> {
  let claimed = false;
  let categoryId: unknown = null;
  try {
    const claim = await Store.updateOne({ _id: storeId, demoSeeded: { $ne: true } }, { $set: { demoSeeded: true } });
    if (claim.modifiedCount === 0) return;
    claimed = true;

    const category = await Category.create({ ...DEMO_CATEGORY, store: storeId, isDemo: true });
    categoryId = category._id;

    const { options, variants, minPrice } = await prepareProductVariants(storeId, { variants: [DEMO_VARIANT] });
    await Product.create({
      ...DEMO_PRODUCT,
      store: storeId,
      categories: [category._id],
      options,
      variants,
      minPrice,
      isPublished: false,
      isDemo: true,
    });
  } catch (err) {
    console.error('[seller-backend] could not seed demo data', { storeId }, err);
    if (claimed) await releaseClaim(storeId, categoryId);
  }
}

async function releaseClaim(storeId: string, categoryId: unknown): Promise<void> {
  try {
    if (categoryId !== null) await Category.deleteOne({ _id: categoryId, store: storeId });
    await Store.updateOne({ _id: storeId }, { $set: { demoSeeded: false } });
  } catch (err) {
    console.error('[seller-backend] could not undo a failed demo seed', { storeId }, err);
  }
}
