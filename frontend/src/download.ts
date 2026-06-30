// Guarda un blob dejando elegir carpeta y nombre. En Edge/Chrome usa el diálogo nativo
// (showSaveFilePicker); en el resto, descarga normal (el navegador decide / pregunta dónde).
export async function guardarBlob(blob: Blob, filename: string) {
  const w = window as unknown as {
    showSaveFilePicker?: (opts: unknown) => Promise<{
      createWritable: () => Promise<{ write: (b: Blob) => Promise<void>; close: () => Promise<void> }>;
    }>;
  };
  if (w.showSaveFilePicker) {
    try {
      const handle = await w.showSaveFilePicker({
        suggestedName: filename,
        types: [{
          description: "Documento Word",
          accept: { "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"] },
        }],
      });
      const ws = await handle.createWritable();
      await ws.write(blob);
      await ws.close();
      return;
    } catch (e) {
      if ((e as DOMException)?.name === "AbortError") return; // el usuario canceló el diálogo
      // cualquier otro error → caemos a la descarga clásica
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
