import type { AllProductsListProps } from "../../types";
import { CategoryProductSection } from "./CategoryProductSection";

export function AllProductsList({
    categories,
    products,
}: AllProductsListProps) {
    return (
        <div className="py-12 md:py-16 px-4 md:px-12 max-w-container-max mx-auto w-full">
            {categories.map((category) => (
                <CategoryProductSection
                    key={category.id}
                    category={category}
                    products={products}
                />
            ))}
        </div>
    );
}