// Utilidades de descarga de documentos.
//
// IMPORTANTE (Azure vs local): `showSaveFilePicker` exige "activación transitoria" (el gesto del
// clic) y caduca si antes hay `await` de red. Por eso el destino se pide ANTES de las llamadas de
// red (dentro del clic) con `pedirDestino`, y luego se escribe con `guardarEn`. En local funcionaba
// por casualidad (las peticiones eran instantáneas); en Azure tardan y el gesto ya no valía.

type SaveHandle = { createWritable: () => Promise<{ write: (b: Blob) => Promise<void>; close: () => Promise<void> }> };

// Pide al usuario dónde guardar. DEBE llamarse dentro del gesto del clic (antes de cualquier await
// de red). Devuelve el handle (Edge/Chrome) o null si el navegador no soporta el selector (entonces
// se usará la descarga normal). `cancelado` = el usuario cerró el diálogo (no se debe seguir).
export async function pedirDestino(suggestedName: string): Promise<{ handle: SaveHandle | null; cancelado: boolean }> {
  const w = window as unknown as { showSaveFilePicker?: (opts: unknown) => Promise<SaveHandle> };
  if (!w.showSaveFilePicker) return { handle: null, cancelado: false };
  try {
    const handle = await w.showSaveFilePicker({
      suggestedName,
      types: [{
        description: "Documento Word",
        accept: { "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"] },
      }],
    });
    return { handle, cancelado: false };
  } catch (e) {
    if ((e as DOMException)?.name === "AbortError") return { handle: null, cancelado: true };
    return { handle: null, cancelado: false }; // no soportado / error → descarga normal de respaldo
  }
}

// Guarda el blob: en el handle elegido (si lo hay) o con una descarga normal (el navegador decide
// la carpeta, o pregunta si está configurado para ello).
export async function guardarEn(handle: SaveHandle | null, blob: Blob, filename: string) {
  if (handle) {
    const ws = await handle.createWritable();
    await ws.write(blob);
    await ws.close();
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
