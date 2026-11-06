"use client";

import type { Order as PayloadOrderDoc } from "@markaz/contracts";
import { useStoreFetch } from "@/lib/hooks/use-store-fetch";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/dashboard/shared/StatusBadge";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["processing", "cancelled"],
  processing: ["dispatched", "cancelled"],
  dispatched: ["delivered", "returned"],
  delivered: ["returned"],
  cancelled: [],
  returned: [],
};

export default function OrderDetailPage() {
  const storeFetch = useStoreFetch();
  const params = useParams<{ id: string }>();
  const [order, setOrder] = useState<PayloadOrderDoc | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [nextStatus, setNextStatus] = useState("");
  const [updating, setUpdating] = useState(false);
  const [downloadingLabel, setDownloadingLabel] = useState(false);

  function load() {
    setIsLoading(true);
    storeFetch(`/api/dashboard/orders/${params.id}`)
      .then((res) => res.json())
      .then((data) => {
        if (data?.id) {
          setOrder(data);
          setNextStatus("");
        } else {
          setErrorMessage("Order not found.");
        }
      })
      .catch(() => setErrorMessage("Could not reach the backend."))
      .finally(() => setIsLoading(false));
  }

  useEffect(load, [params.id, storeFetch]);

  async function handleUpdateStatus() {
    if (!nextStatus) return;
    setUpdating(true);
    setErrorMessage(null);
    try {
      const res = await storeFetch(`/api/dashboard/orders/${params.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        setErrorMessage(data?.error ?? "Could not update status.");
        return;
      }
      load();
    } catch {
      setErrorMessage("Could not reach the backend. Please try again.");
    } finally {
      setUpdating(false);
    }
  }

  async function handlePrintLabel() {
    setDownloadingLabel(true);
    setErrorMessage(null);
    try {
      const res = await storeFetch(`/api/dashboard/orders/${params.id}/label`);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setErrorMessage(data?.error ?? "Could not fetch label.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `label-${order?.orderId ?? params.id}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setErrorMessage("Could not reach the backend. Please try again.");
    } finally {
      setDownloadingLabel(false);
    }
  }

  if (isLoading) return <div className="p-6 sm:p-8 text-sm text-muted-foreground">Loading...</div>;
  if (!order) return <div className="p-6 sm:p-8 text-sm text-destructive">{errorMessage ?? "Order not found."}</div>;

  const options = ALLOWED_TRANSITIONS[order.status] ?? [];

  return (
    <div className="p-6 sm:p-8 max-w-2xl">
      <h1 className="font-heading text-2xl mb-1">{order.orderId}</h1>
      <p className="text-sm text-muted-foreground mb-6">{new Date(order.createdAt).toLocaleString()}</p>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Customer</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm flex flex-col gap-1">
            <p>{order.customerName}</p>
            <p className="font-mono">{order.phone}</p>
            {order.secondaryPhone && <p className="font-mono text-muted-foreground">{order.secondaryPhone}</p>}
            <p>{order.city}</p>
            <p>{order.address}</p>
            {order.notes && <p className="text-muted-foreground italic">{order.notes}</p>}
          </div>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Items</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableBody>
              {order.items?.map((item, i) => (
                <TableRow key={i}>
                  <TableCell>{item.productTitle}</TableCell>
                  <TableCell className="text-muted-foreground">× {item.quantity}</TableCell>
                  <TableCell className="text-right">PKR {(item.unitPrice * item.quantity).toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="border-t mt-3 pt-3 text-sm flex flex-col gap-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span>PKR {order.subtotal.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Delivery</span>
              <span>{order.deliveryCharges === 0 ? "Free" : `PKR ${order.deliveryCharges.toLocaleString()}`}</span>
            </div>
            <div className="flex justify-between font-medium">
              <span>Total</span>
              <span>PKR {order.total.toLocaleString()}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Status</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm mb-4 flex items-center gap-2">
            Current: <StatusBadge status={order.status} />
          </p>

          {order.status === "dispatched" && order.trackingNumber && (
            <div className="flex items-center gap-3 mb-4">
              <span className="px-3 py-1.5 rounded-full text-xs font-mono bg-purple-100 text-purple-700">
                Tracking: {order.trackingNumber}
              </span>
              <Button variant="link" size="sm" onClick={handlePrintLabel} disabled={downloadingLabel}>
                {downloadingLabel ? "Downloading..." : "Print Label"}
              </Button>
            </div>
          )}

          {options.length > 0 ? (
            <div className="flex gap-3">
              <Select value={nextStatus} onValueChange={(v) => v && setNextStatus(v)}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="Change status to..." />
                </SelectTrigger>
                <SelectContent>
                  {options.map((opt) => (
                    <SelectItem key={opt} value={opt} className="capitalize">{opt}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={handleUpdateStatus} disabled={!nextStatus || updating}>
                {updating ? "Updating..." : "Update Status"}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">This order has no further status transitions.</p>
          )}

          {errorMessage && <p className="text-sm text-destructive mt-3">{errorMessage}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
