"use client";

import type { SellerProductDetail } from "@markaz/contracts";
import { useStoreFetch } from "@/lib/hooks/use-store-fetch";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ProductForm } from "@/components/dashboard/ProductForm";
import { PageHeader } from "@/components/dashboard/shared/PageHeader";
import { LoadingState } from "@/components/dashboard/shared/LoadingState";
import { ErrorState } from "@/components/dashboard/shared/ErrorState";
import { Badge } from "@/components/ui/badge";

export default function EditProductPage() {
  const storeFetch = useStoreFetch();
  const params = useParams<{ id: string }>();
  const [product, setProduct] = useState<SellerProductDetail | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    storeFetch(`/api/dashboard/products/${params.id}`)
      .then((res) => res.json())
      .then((data) => {
        if (data?.id) setProduct(data);
        else setErrorMessage("Product not found.");
      })
      .catch(() => setErrorMessage("Could not reach the backend."))
      .finally(() => setIsLoading(false));
  }, [params.id, storeFetch]);

  return (
    <div className="p-6 sm:p-8">
      <PageHeader title="Edit Product">
        {product?.isDemo ? <Badge variant="secondary">Demo</Badge> : null}
      </PageHeader>
      {isLoading && <LoadingState />}
      {errorMessage && <ErrorState message={errorMessage} />}
      {product && <ProductForm product={product} />}
    </div>
  );
}
