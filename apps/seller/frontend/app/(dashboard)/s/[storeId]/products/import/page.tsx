"use client";

import type { ProductImportReport } from "@markaz/contracts";
import { useStoreFetch } from "@/lib/hooks/use-store-fetch";
import { useActiveStoreId, useStoreHref } from "@/lib/dashboard-context";
import { refusalMessage } from "@/lib/product-actions";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";

const MAX_BYTES = 2 * 1024 * 1024;

export default function ImportProductsPage() {
  const storeFetch = useStoreFetch();
  const href = useStoreHref();
  const storeId = useActiveStoreId();
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<ProductImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const chosen = e.target.files?.[0] ?? null;
    setReport(null);
    setError(chosen && chosen.size > MAX_BYTES ? "A file can be at most 2 MB." : null);
    setFile(chosen && chosen.size <= MAX_BYTES ? chosen : null);
  }

  async function run(dryRun: boolean) {
    if (!file) return;
    setRunning(true);
    setError(null);
    setReport(null);
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("dryRun", String(dryRun));
      const res = await storeFetch("/api/dashboard/products/import", { method: "POST", body });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setError(refusalMessage(data, "Import failed."));
        return;
      }
      setReport(data as ProductImportReport);
    } catch {
      setError("Could not reach the backend. Please try again.");
    } finally {
      setRunning(false);
    }
  }

  function downloadFailed() {
    if (!report?.failedCsv) return;
    const link = document.createElement("a");
    // The backend starts the file with a UTF-8 byte order mark so Excel keeps Urdu intact. Add it if a hop dropped it.
    const csv = report.failedCsv.startsWith("﻿") ? report.failedCsv : "﻿" + report.failedCsv;
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    link.download = "failed-rows.csv";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  const rowsToShow = report?.rows.filter((row) => row.status === "error" || row.warnings.length > 0) ?? [];

  return (
    <div className="p-6 sm:p-8 max-w-3xl">
      <h1 className="font-heading text-2xl mb-1">Import Products</h1>
      <div className="text-sm text-muted-foreground mb-6 flex flex-col gap-2">
        <p>
          One product is one or more rows that share a <code className="font-mono text-xs">Handle</code>. The first row carries the product; each further row
          is one more variant. A Handle that already exists updates that product, and an empty cell leaves its value alone.
        </p>
        <p>
          Category is a category name in this store. Image URLs and Video URLs must be files already in this store, separated by{" "}
          <code className="font-mono text-xs">|</code>. Variant Inventory Qty only sets the stock of a new variant: existing stock changes in Inventory.
        </p>
        <p>At most 500 rows and 2 MB.</p>
        <p>In Excel, save the file as &quot;CSV UTF-8&quot; (not plain &quot;CSV&quot;), or Urdu text will be damaged and those rows refused.</p>
        <a href={`/api/dashboard/products/export?template=1&storeId=${encodeURIComponent(storeId)}`} className="underline underline-offset-4 w-fit">Download the CSV template</a>
      </div>

      <input type="file" accept=".csv,text/csv" onChange={handleFile} className="text-sm mb-6 block" />

      {running && <Progress value={null} className="mb-4" />}

      <div className="flex flex-wrap gap-2">
        <Button variant="clay-soft" onClick={() => run(true)} disabled={!file || running}>Validate only</Button>
        <Button onClick={() => run(false)} disabled={!file || running}>{running ? "Working…" : "Import"}</Button>
      </div>

      {error && (
        <Alert variant="destructive" className="mt-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {report && (
        <Card className="mt-6">
          <CardContent className="pt-6 flex flex-col gap-3">
            <p className="text-sm">
              {report.dryRun ? "Nothing was saved. A real import would give: " : ""}
              <span className="font-medium">{report.created} created</span>, <span className="font-medium">{report.updated} updated</span>,{" "}
              <span className="text-destructive font-medium">{report.failed} failed</span>.
            </p>
            {rowsToShow.length > 0 && (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Row</TableHead>
                      <TableHead>Handle</TableHead>
                      <TableHead>Result</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rowsToShow.map((row) => (
                      <TableRow key={row.row}>
                        <TableCell className="text-xs">{row.row}</TableCell>
                        <TableCell className="text-xs font-mono">{row.handle}</TableCell>
                        <TableCell className="text-xs whitespace-normal">
                          {row.message ? <p className="text-destructive">{row.message}</p> : null}
                          {row.warnings.map((warning) => (
                            <p key={warning}>{warning}</p>
                          ))}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {report.failedCsv ? <Button variant="clay-soft" onClick={downloadFailed}>Download failed rows</Button> : null}
              {!report.dryRun && report.created + report.updated > 0 ? (
                <Button variant="link" onClick={() => router.push(href("/products"))} className="px-0">View products →</Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
