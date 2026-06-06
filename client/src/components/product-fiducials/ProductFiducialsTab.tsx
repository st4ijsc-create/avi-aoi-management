/**
 * P1 — Product Fiducial Marks management UI.
 *
 * Self-contained React component. Drop-in usage:
 *
 *   {selectedProduct && (
 *     <ProductFiducialsTab productModelId={selectedProduct.id} />
 *   )}
 *
 * Wires the `trpc.fiducialMark.*` procedures (P1 backend) and the
 * `measurementPointP1.fiducial.*` i18n namespace.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";

type FiducialType = "cross" | "circle" | "square" | "custom";

const FIDUCIAL_TYPES: FiducialType[] = ["cross", "circle", "square", "custom"];

interface Props {
  productModelId: number;
}

interface EditState {
  id?: number;
  code: string;
  name: string;
  type: FiducialType;
  positionX: number;
  positionY: number;
  searchWindowW: number;
  searchWindowH: number;
  orderIndex: number;
}

const blankEdit = (): EditState => ({
  code: "",
  name: "",
  type: "cross",
  positionX: 0,
  positionY: 0,
  searchWindowW: 64,
  searchWindowH: 64,
  orderIndex: 0,
});

export function ProductFiducialsTab({ productModelId }: Props) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<EditState | null>(null);
  const [showDialog, setShowDialog] = useState(false);

  const utils = trpc.useUtils();
  const { data: fiducials, isLoading } = trpc.fiducialMark.listByProductModel.useQuery({
    productModelId,
  });

  const refetch = () => utils.fiducialMark.listByProductModel.invalidate({ productModelId });

  const createMut = trpc.fiducialMark.create.useMutation({
    onSuccess: () => {
      refetch();
      setShowDialog(false);
      setEditing(null);
    },
  });
  const updateMut = trpc.fiducialMark.update.useMutation({
    onSuccess: () => {
      refetch();
      setShowDialog(false);
      setEditing(null);
    },
  });
  const deleteMut = trpc.fiducialMark.delete.useMutation({
    onSuccess: () => refetch(),
  });

  const onSave = () => {
    if (!editing) return;
    if (editing.id) {
      updateMut.mutate({
        id: editing.id,
        code: editing.code,
        name: editing.name,
        type: editing.type,
        positionX: editing.positionX,
        positionY: editing.positionY,
        searchWindowW: editing.searchWindowW,
        searchWindowH: editing.searchWindowH,
        orderIndex: editing.orderIndex,
      });
    } else {
      createMut.mutate({
        productModelId,
        code: editing.code,
        name: editing.name,
        type: editing.type,
        positionX: editing.positionX,
        positionY: editing.positionY,
        searchWindowW: editing.searchWindowW,
        searchWindowH: editing.searchWindowH,
        orderIndex: editing.orderIndex,
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">{t("measurementPointP1.fiducial.title")}</h3>
        <button
          type="button"
          className="px-3 py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-700"
          onClick={() => {
            setEditing(blankEdit());
            setShowDialog(true);
          }}
        >
          {t("measurementPointP1.fiducial.addButton")}
        </button>
      </div>

      {isLoading ? (
        <div className="text-sm text-gray-500">…</div>
      ) : !fiducials || fiducials.length === 0 ? (
        <div className="text-sm text-gray-500 italic">
          {t("measurementPointP1.fiducial.empty")}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm border">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left">{t("measurementPointP1.fiducial.code")}</th>
                <th className="px-3 py-2 text-left">{t("measurementPointP1.fiducial.name")}</th>
                <th className="px-3 py-2 text-left">{t("measurementPointP1.fiducial.type")}</th>
                <th className="px-3 py-2 text-left">{t("measurementPointP1.fiducial.position")}</th>
                <th className="px-3 py-2 text-left">{t("measurementPointP1.fiducial.searchWindow")}</th>
                <th className="px-3 py-2 text-left">{t("measurementPointP1.fiducial.orderIndex")}</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {fiducials.map((f: any) => (
                <tr key={f.id} className="border-t">
                  <td className="px-3 py-2 font-mono">{f.code}</td>
                  <td className="px-3 py-2">{f.name}</td>
                  <td className="px-3 py-2">
                    {t(`measurementPointP1.fiducial.types.${f.type as FiducialType}`)}
                  </td>
                  <td className="px-3 py-2">
                    ({f.positionX}, {f.positionY})
                  </td>
                  <td className="px-3 py-2">
                    {f.searchWindowW ?? 64} × {f.searchWindowH ?? 64}
                  </td>
                  <td className="px-3 py-2">{f.orderIndex ?? 0}</td>
                  <td className="px-3 py-2 text-right space-x-2">
                    <button
                      type="button"
                      className="text-blue-600 hover:underline"
                      onClick={() => {
                        setEditing({
                          id: f.id,
                          code: f.code,
                          name: f.name,
                          type: (f.type as FiducialType) ?? "cross",
                          positionX: f.positionX,
                          positionY: f.positionY,
                          searchWindowW: f.searchWindowW ?? 64,
                          searchWindowH: f.searchWindowH ?? 64,
                          orderIndex: f.orderIndex ?? 0,
                        });
                        setShowDialog(true);
                      }}
                    >
                      {t("measurementPointP1.fiducial.edit")}
                    </button>
                    <button
                      type="button"
                      className="text-red-600 hover:underline"
                      onClick={() => {
                        if (window.confirm(t("measurementPointP1.fiducial.confirmDelete"))) {
                          deleteMut.mutate({ id: f.id });
                        }
                      }}
                    >
                      {t("measurementPointP1.fiducial.delete")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showDialog && editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded shadow-lg w-full max-w-md p-5 space-y-3">
            <h4 className="font-semibold">
              {editing.id
                ? t("measurementPointP1.fiducial.edit")
                : t("measurementPointP1.fiducial.addButton")}
            </h4>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <label className="flex flex-col">
                <span>{t("measurementPointP1.fiducial.code")}</span>
                <input
                  className="border rounded px-2 py-1"
                  value={editing.code}
                  onChange={(e) => setEditing({ ...editing, code: e.target.value })}
                />
              </label>
              <label className="flex flex-col">
                <span>{t("measurementPointP1.fiducial.name")}</span>
                <input
                  className="border rounded px-2 py-1"
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                />
              </label>
              <label className="flex flex-col">
                <span>{t("measurementPointP1.fiducial.type")}</span>
                <select
                  className="border rounded px-2 py-1"
                  value={editing.type}
                  onChange={(e) =>
                    setEditing({ ...editing, type: e.target.value as FiducialType })
                  }
                >
                  {FIDUCIAL_TYPES.map((tp) => (
                    <option key={tp} value={tp}>
                      {t(`measurementPointP1.fiducial.types.${tp}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col">
                <span>{t("measurementPointP1.fiducial.orderIndex")}</span>
                <input
                  type="number"
                  className="border rounded px-2 py-1"
                  value={editing.orderIndex}
                  onChange={(e) =>
                    setEditing({ ...editing, orderIndex: Number(e.target.value) || 0 })
                  }
                />
              </label>
              <label className="flex flex-col">
                <span>X</span>
                <input
                  type="number"
                  className="border rounded px-2 py-1"
                  value={editing.positionX}
                  onChange={(e) =>
                    setEditing({ ...editing, positionX: Number(e.target.value) || 0 })
                  }
                />
              </label>
              <label className="flex flex-col">
                <span>Y</span>
                <input
                  type="number"
                  className="border rounded px-2 py-1"
                  value={editing.positionY}
                  onChange={(e) =>
                    setEditing({ ...editing, positionY: Number(e.target.value) || 0 })
                  }
                />
              </label>
              <label className="flex flex-col">
                <span>W</span>
                <input
                  type="number"
                  className="border rounded px-2 py-1"
                  value={editing.searchWindowW}
                  onChange={(e) =>
                    setEditing({ ...editing, searchWindowW: Number(e.target.value) || 0 })
                  }
                />
              </label>
              <label className="flex flex-col">
                <span>H</span>
                <input
                  type="number"
                  className="border rounded px-2 py-1"
                  value={editing.searchWindowH}
                  onChange={(e) =>
                    setEditing({ ...editing, searchWindowH: Number(e.target.value) || 0 })
                  }
                />
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                className="px-3 py-1.5 text-sm rounded border"
                onClick={() => {
                  setShowDialog(false);
                  setEditing(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="px-3 py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-700"
                disabled={createMut.isPending || updateMut.isPending}
                onClick={onSave}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ProductFiducialsTab;
