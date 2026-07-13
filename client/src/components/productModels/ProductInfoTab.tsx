/**
 * doc 48 R4 (tech-debt) — "Product Info tab body" extracted VERBATIM from ProductModels.tsx.
 * PURE RELOCATION: the page still owns all state/queries/mutations/handlers and threads
 * them 1:1 as props (names unchanged); `t`/`user` are re-derived from hooks locally, as in
 * the sibling components/products/* dialogs. Identical JSX/handlers — no behavior change.
 */

import type { Dispatch, SetStateAction, ChangeEvent } from "react";
import { type RouterOutputs, type ProductModel } from "./types";
import { PermissionGate } from "@/components/PermissionGate";
import ProductGoldenSamplesPanel from "@/components/products/ProductGoldenSamplesPanel";
import ProductReadinessPanel from "@/components/products/ProductReadinessPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { FileText, Paperclip, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

interface ProductInfoTabProps {
  deleteDocumentMutation: ReturnType<typeof trpc.productDocument.delete.useMutation>;
  handleDocumentUpload: (e: ChangeEvent<HTMLInputElement>) => void;
  productDocuments: RouterOutputs["productDocument"]["list"] | undefined;
  selectedProduct: ProductModel;
  setShowDocuments: Dispatch<SetStateAction<boolean>>;
  showDocuments: boolean;
  uploadDocumentMutation: ReturnType<typeof trpc.productDocument.upload.useMutation>;
}

export function ProductInfoTab(props: ProductInfoTabProps) {
  const { t } = useTranslation();
  const {
    deleteDocumentMutation, handleDocumentUpload, productDocuments, selectedProduct,
    setShowDocuments, showDocuments, uploadDocumentMutation,
  } = props;
  return (
    <>
                {/* Doc 31 UX2/PM9/UX7 — readiness checklist + contextual cross-links */}
                <ProductReadinessPanel productModelId={selectedProduct.id} productCode={selectedProduct.code} />

                {/* Doc 31 PM5/UX8 — golden samples for this product (surface + capture deep-link) */}
                <ProductGoldenSamplesPanel productModelId={selectedProduct.id} productCode={selectedProduct.code} />

              {/* ─── Product Documents Section ─── */}
              <div className="border-t pt-4 mt-4">
                <div
                  className="flex items-center justify-between cursor-pointer select-none"
                  onClick={() => setShowDocuments(!showDocuments)}
                >
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    <h3 className="font-semibold text-sm">{t("products.documents")}</h3>
                    {productDocuments && (
                      <Badge variant="secondary" className="text-xs">{productDocuments.length}</Badge>
                    )}
                  </div>
                  <Button variant="ghost" size="sm">
                    {showDocuments ? "▲" : "▼"}
                  </Button>
                </div>

                {showDocuments && (
                  <div className="mt-3 space-y-3">
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1"
                        onClick={() => document.getElementById('doc-upload-input')?.click()}
                        disabled={uploadDocumentMutation.isPending}
                      >
                        <Paperclip className="h-3.5 w-3.5" />
                        {uploadDocumentMutation.isPending ? t("common.uploading") : t("products.attachDocument")}
                      </Button>
                      <input
                        id="doc-upload-input"
                        type="file"
                        className="hidden"
                        accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                        onChange={handleDocumentUpload}
                      />
                    </div>

                    {productDocuments && productDocuments.length > 0 ? (
                      <div className="space-y-2 max-h-60 overflow-y-auto">
                        {productDocuments.map((doc) => (
                          <div key={doc.id} className="flex items-center justify-between p-2 border rounded-md hover:bg-muted/50 text-sm">
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                              <a
                                href={doc.fileUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="truncate text-info hover:underline"
                                title={doc.fileName}
                              >
                                {doc.fileName}
                              </a>
                              {doc.fileSize && (
                                <span className="text-xs text-muted-foreground shrink-0">
                                  {(doc.fileSize / 1024).toFixed(0)} KB
                                </span>
                              )}
                            </div>
                            <PermissionGate module="settings_products" action="canDelete">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 shrink-0"
                                onClick={() => deleteDocumentMutation.mutate({ id: doc.id })}
                                disabled={deleteDocumentMutation.isPending}
                              >
                                <Trash2 className="h-3.5 w-3.5 text-destructive" />
                              </Button>
                            </PermissionGate>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">{t("products.noDocuments")}</p>
                    )}
                  </div>
                )}
              </div>
    </>
  );
}
