"use client";

import { useStoreFetch } from "@/lib/hooks/use-store-fetch";
import { useStoreHref } from "@/lib/dashboard-context";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";

interface ImportError {
  row: number;
  reason: string;
}

export default function ImportProductsPage() {
  const storeFetch = useStoreFetch();
  const href = useStoreHref();
  const router = useRouter();
  const [csvText, setCsvText] = useState<string | null>(null);
  const [preview, setPreview] = useState<Record<string, string>[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ success: number; errors: ImportError[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setResult(null);
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      setCsvText(text);
      const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
      setPreview(parsed.data.slice(0, 5));
    };
    reader.readAsText(file);
  }

  async function handleImport() {
    if (!csvText) return;
    setImporting(true);
    setError(null);
    try {
      const res = await storeFetch("/api/dashboard/products/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: csvText }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "Import failed.");
        return;
      }
      setResult(data);
    } catch {
      setError("Could not reach the backend. Please try again.");
    } finally {
      setImporting(false);
    }
  }

  const columns = preview.length > 0 ? Object.keys(preview[0]) : [];

  return (
    <div className="p-6 sm:p-8 max-w-3xl">
      <h1 className="font-heading text-2xl mb-1">Import Products</h1>
      <p className="text-sm text-muted-foreground mb-6">
        CSV columns: <code className="font-mono text-xs">title*, slug, price*, originalPrice, description,
        category, stockStatus, stockQuantity, isFeatured, highlights</code>. Separate multiple highlights with
        a <code className="font-mono text-xs">|</code>. Note: imported products still need at least one image
        added afterwards via Edit — the CSV format has no way to supply one.
      </p>

      <input type="file" accept=".csv" onChange={handleFile} className="text-sm mb-6" />

      {preview.length > 0 && (
        <Card className="overflow-x-auto mb-6">
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((c) => (
                  <TableHead key={c} className="font-mono text-xs">
                    {c}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {preview.map((row, i) => (
                <TableRow key={i}>
                  {columns.map((c) => (
                    <TableCell key={c} className="text-xs">
                      {row[c]}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="text-xs text-muted-foreground px-4 py-3 border-t">
            Showing first {preview.length} rows.
          </div>
        </Card>
      )}

      {importing && <Progress value={null} className="mb-4" />}

      {csvText && (
        <Button
          onClick={handleImport}
          disabled={importing}
        >
          {importing ? "Importing…" : "Import"}
        </Button>
      )}

      {error && (
        <Alert variant="destructive" className="mt-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {result && (
        <Card className="mt-6">
          <CardContent className="pt-6">
            <p className="text-sm mb-3">
              <span className="text-success font-medium">{result.success} imported</span>
              {result.errors.length > 0 && (
                <span className="text-destructive font-medium"> · {result.errors.length} failed</span>
              )}
            </p>
            {result.errors.length > 0 && (
              <ul className="text-xs font-mono flex flex-col gap-1">
                {result.errors.map((e, i) => (
                  <li key={i} className="text-destructive">
                    Row {e.row}: {e.reason}
                  </li>
                ))}
              </ul>
            )}
            {result.success > 0 && (
              <Button variant="link" onClick={() => router.push(href("/products"))} className="px-0 mt-4">
                View products →
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
