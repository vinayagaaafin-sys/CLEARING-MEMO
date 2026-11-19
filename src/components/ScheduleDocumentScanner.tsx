import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  Check,
  Contrast,
  Crop,
  FileText,
  Maximize2,
  RotateCcw,
  RotateCw,
  ScanLine,
  Trash2,
  Upload,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  deleteDocumentBlob,
  formatFileSize,
  getDocumentBlob,
  saveDocumentBlob,
} from '../services/documentBlobStore';
import { ScheduleScanDocument } from '../types/treasury';

interface ScheduleDocumentScannerProps {
  documents: ScheduleScanDocument[];
  onChangeDocuments: (nextDocs: ScheduleScanDocument[]) => void;
}

const SCAN_LABEL_OPTIONS = [
  'PDC Cheque Leaf',
  'Customer KYC',
  'Sanction Letter',
  'EMI Mandate / ECS',
  'Other',
];

async function createImageThumbnail(file: Blob): Promise<string | undefined> {
  if (!file.type.startsWith('image/')) return undefined;
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const maxW = 280;
        const scale = Math.min(1, maxW / (img.naturalWidth || maxW));
        const w = Math.max(1, Math.round((img.naturalWidth || maxW) * scale));
        const h = Math.max(1, Math.round((img.naturalHeight || maxW) * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(url);
          resolve(undefined);
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.72);
        URL.revokeObjectURL(url);
        resolve(dataUrl);
      } catch {
        URL.revokeObjectURL(url);
        resolve(undefined);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(undefined);
    };
    img.src = url;
  });
}

export function ScheduleDocumentScanner({
  documents,
  onChangeDocuments,
}: ScheduleDocumentScannerProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  const [selectedDocId, setSelectedDocId] = useState<string>(
    documents[0]?.id || ''
  );
  const [selectedLabel, setSelectedLabel] = useState<string>('PDC Cheque Leaf');
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Inspection / Zoom / Rotate / Contrast / Crop controls
  const [zoom, setZoom] = useState<number>(1);
  const [rotation, setRotation] = useState<number>(0);
  const [highContrast, setHighContrast] = useState<boolean>(false);
  const [isCropMode, setIsCropMode] = useState<boolean>(false);
  const [cropStart, setCropStart] = useState<{ x: number; y: number } | null>(
    null
  );
  const [cropRect, setCropRect] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);

  useEffect(() => {
    if (documents.length === 0) {
      setSelectedDocId('');
      return;
    }
    if (!documents.some((d) => d.id === selectedDocId)) {
      setSelectedDocId(documents[0].id);
    }
  }, [documents, selectedDocId]);

  const activeDoc = documents.find((d) => d.id === selectedDocId) || null;

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    setPreviewUrl(null);
    setCropRect(null);
    setIsCropMode(false);
    setZoom(1);
    setRotation(0);

    if (!activeDoc) return;

    void getDocumentBlob(activeDoc.id).then((blob) => {
      if (!active) return;
      if (blob) {
        objectUrl = URL.createObjectURL(blob);
        setPreviewUrl(objectUrl);
      } else if (activeDoc.thumbnailDataUrl) {
        setPreviewUrl(activeDoc.thumbnailDataUrl);
      }
    });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [activeDoc]);

  const processIncomingFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList).filter(
      (f) => f.type.startsWith('image/') || f.type === 'application/pdf'
    );
    if (files.length === 0) return;

    const added: ScheduleScanDocument[] = [];
    for (const file of files) {
      const id = `schscan-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      await saveDocumentBlob(id, file, file.name, file.type);
      const thumbnailDataUrl = await createImageThumbnail(file);
      added.push({
        id,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        fileSize: file.size,
        uploadedAt: new Date().toISOString(),
        label: selectedLabel,
        thumbnailDataUrl,
      });
    }

    const next = [...added, ...documents];
    onChangeDocuments(next);
    if (added[0]) {
      setSelectedDocId(added[0].id);
    }
  };

  const handleRemoveDoc = (docId: string) => {
    void deleteDocumentBlob(docId);
    const next = documents.filter((d) => d.id !== docId);
    onChangeDocuments(next);
  };

  const handleApplyCropToImage = async () => {
    if (!activeDoc || !cropRect || !imageRef.current) return;
    if (cropRect.w < 12 || cropRect.h < 12) return;

    const imgEl = imageRef.current;
    const rect = imgEl.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const scaleX = imgEl.naturalWidth / rect.width;
    const scaleY = imgEl.naturalHeight / rect.height;

    const sx = Math.max(0, Math.round(cropRect.x * scaleX));
    const sy = Math.max(0, Math.round(cropRect.y * scaleY));
    const sw = Math.min(
      imgEl.naturalWidth - sx,
      Math.max(10, Math.round(cropRect.w * scaleX))
    );
    const sh = Math.min(
      imgEl.naturalHeight - sy,
      Math.max(10, Math.round(cropRect.h * scaleY))
    );

    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(imgEl, sx, sy, sw, sh, 0, 0, sw, sh);

    canvas.toBlob(
      async (croppedBlob) => {
        if (!croppedBlob) return;
        await saveDocumentBlob(
          activeDoc.id,
          croppedBlob,
          activeDoc.fileName,
          'image/jpeg'
        );
        const thumb = await createImageThumbnail(croppedBlob);
        onChangeDocuments(
          documents.map((d) =>
            d.id === activeDoc.id
              ? {
                  ...d,
                  fileSize: croppedBlob.size,
                  mimeType: 'image/jpeg',
                  thumbnailDataUrl: thumb || d.thumbnailDataUrl,
                }
              : d
          )
        );
        const newUrl = URL.createObjectURL(croppedBlob);
        setPreviewUrl(newUrl);
        setCropRect(null);
        setIsCropMode(false);
        setZoom(1);
        setRotation(0);
      },
      'image/jpeg',
      0.92
    );
  };

  const isPdf = activeDoc?.mimeType === 'application/pdf';

  return (
    <aside className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
      <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-200">
        <div className="flex items-start gap-2.5">
          <div className="w-8 h-8 rounded-md bg-[#0B192C] text-white flex items-center justify-center shrink-0">
            <ScanLine className="w-4 h-4" aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Document &amp; Cheque Scanner
            </h3>
            <p className="text-xs text-slate-500">
              Scan physical PDC leaves, KYC, or sanction letters beside the form to read numbers &amp; dates easily.
            </p>
          </div>
        </div>
        <span className="text-[11px] font-mono-num font-semibold text-slate-700 whitespace-nowrap">
          {documents.length} Attached
        </span>
      </div>

      {/* Document Label + Upload / Camera Triggers */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 items-end">
        <div>
          <label className="block text-[11px] font-medium text-slate-600 mb-1">
            Scan Document Type
          </label>
          <select
            value={selectedLabel}
            onChange={(e) => setSelectedLabel(e.target.value)}
            className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white text-slate-800"
          >
            {SCAN_LABEL_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,.pdf,application/pdf"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void processIncomingFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 transition-colors whitespace-nowrap"
        >
          <Upload className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Upload Image / PDF</span>
        </button>

        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void processIncomingFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          onClick={() => cameraInputRef.current?.click()}
          className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap"
        >
          <Camera className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Capture via Camera</span>
        </button>
      </div>

      {/* Drag & Drop Zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDraggingOver(true);
        }}
        onDragLeave={() => setIsDraggingOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDraggingOver(false);
          if (e.dataTransfer.files) {
            void processIncomingFiles(e.dataTransfer.files);
          }
        }}
        onClick={() => {
          if (!activeDoc) fileInputRef.current?.click();
        }}
        className={`border-2 border-dashed rounded-lg transition-colors ${
          isDraggingOver
            ? 'border-slate-900 bg-slate-100'
            : 'border-slate-300 bg-slate-50/70'
        } ${!activeDoc ? 'cursor-pointer hover:border-slate-400' : ''}`}
      >
        {!activeDoc ? (
          <div className="py-10 px-4 text-center space-y-2">
            <ScanLine className="w-8 h-8 text-slate-400 mx-auto" />
            <div className="text-xs font-semibold text-slate-800">
              Drag &amp; drop cheque scan (JPG, PNG, PDF) or use Camera Capture
            </div>
            <p className="text-[11px] text-slate-500 max-w-xs mx-auto">
              Once uploaded, zoom, rotate, contrast-enhance, or crop right here while typing cheque numbers and EMI dates.
            </p>
          </div>
        ) : (
          <div className="p-3 space-y-2.5">
            {/* Image / PDF Inspection Controls */}
            {!isPdf && previewUrl && (
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-200">
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))}
                    title="Zoom Out"
                    className="p-1.5 text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50"
                  >
                    <ZoomOut className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-[11px] font-mono-num font-semibold text-slate-700 px-1.5">
                    {Math.round(zoom * 100)}%
                  </span>
                  <button
                    type="button"
                    onClick={() => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))}
                    title="Zoom In"
                    className="p-1.5 text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50"
                  >
                    <ZoomIn className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setRotation((r) => (r - 90 + 360) % 360)}
                    title="Rotate Left 90°"
                    className="p-1.5 text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setRotation((r) => (r + 90) % 360)}
                    title="Rotate Right 90°"
                    className="p-1.5 text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50"
                  >
                    <RotateCw className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setHighContrast((v) => !v)}
                    title="Toggle High-Contrast OCR Readability"
                    className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border transition-colors ${
                      highContrast
                        ? 'bg-[#0B192C] text-white border-[#0B192C]'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <Contrast className="w-3 h-3" />
                    <span>OCR Contrast</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsCropMode((v) => !v);
                      setCropRect(null);
                      setZoom(1);
                      setRotation(0);
                    }}
                    title="Drag a crop rectangle on the cheque image"
                    className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border transition-colors ${
                      isCropMode
                        ? 'bg-amber-600 text-white border-amber-600'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <Crop className="w-3 h-3" />
                    <span>{isCropMode ? 'Drawing Crop...' : 'Crop'}</span>
                  </button>
                </div>

                <div className="flex items-center gap-1.5">
                  {isCropMode && cropRect && cropRect.w > 12 && cropRect.h > 12 && (
                    <button
                      type="button"
                      onClick={() => void handleApplyCropToImage()}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-white bg-emerald-700 rounded hover:bg-emerald-800"
                    >
                      <Check className="w-3 h-3" />
                      <span>Apply Crop</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setZoom(1);
                      setRotation(0);
                      setHighContrast(false);
                      setIsCropMode(false);
                      setCropRect(null);
                    }}
                    title="Reset View"
                    className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-slate-600 hover:text-slate-900"
                  >
                    <Maximize2 className="w-3 h-3" />
                    <span>Reset</span>
                  </button>
                </div>
              </div>
            )}

            {/* Preview Viewport */}
            <div className="bg-slate-900 rounded-md overflow-auto max-h-[380px] min-h-[240px] flex items-center justify-center p-2 relative select-none">
              {!previewUrl ? (
                <div className="text-xs text-slate-300">Loading preview...</div>
              ) : isPdf ? (
                <iframe
                  title={activeDoc.fileName}
                  src={previewUrl}
                  className="w-full h-[360px] bg-white rounded"
                />
              ) : isCropMode ? (
                <div
                  ref={stageRef}
                  className="relative inline-block cursor-crosshair"
                  onMouseDown={(e) => {
                    const bounds = e.currentTarget.getBoundingClientRect();
                    const x = e.clientX - bounds.left;
                    const y = e.clientY - bounds.top;
                    setCropStart({ x, y });
                    setCropRect({ x, y, w: 0, h: 0 });
                  }}
                  onMouseMove={(e) => {
                    if (!cropStart) return;
                    const bounds = e.currentTarget.getBoundingClientRect();
                    const currX = Math.max(
                      0,
                      Math.min(bounds.width, e.clientX - bounds.left)
                    );
                    const currY = Math.max(
                      0,
                      Math.min(bounds.height, e.clientY - bounds.top)
                    );
                    setCropRect({
                      x: Math.min(cropStart.x, currX),
                      y: Math.min(cropStart.y, currY),
                      w: Math.abs(currX - cropStart.x),
                      h: Math.abs(currY - cropStart.y),
                    });
                  }}
                  onMouseUp={() => setCropStart(null)}
                >
                  <img
                    ref={imageRef}
                    src={previewUrl}
                    alt={activeDoc.fileName}
                    draggable={false}
                    className={`max-h-[340px] w-auto object-contain block ${
                      highContrast ? 'grayscale contrast-150 brightness-105' : ''
                    }`}
                  />
                  {cropRect && cropRect.w > 2 && cropRect.h > 2 && (
                    <div
                      className="absolute border-2 border-amber-400 bg-amber-400/20 pointer-events-none"
                      style={{
                        left: cropRect.x,
                        top: cropRect.y,
                        width: cropRect.w,
                        height: cropRect.h,
                      }}
                    />
                  )}
                </div>
              ) : (
                <img
                  ref={imageRef}
                  src={previewUrl}
                  alt={activeDoc.fileName}
                  className={`max-h-[340px] w-auto object-contain transition-transform duration-150 ${
                    highContrast ? 'grayscale contrast-150 brightness-105' : ''
                  }`}
                  style={{
                    transform: `scale(${zoom}) rotate(${rotation}deg)`,
                    transformOrigin: 'center center',
                  }}
                />
              )}
            </div>
          </div>
        )}
      </div>

      {/* Attached Scanned Files List */}
      {documents.length > 0 && (
        <div className="space-y-2">
          <div className="text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
            Attached Scans ({documents.length})
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-0.5">
            {documents.map((doc) => {
              const isSelected = doc.id === activeDoc?.id;
              return (
                <div
                  key={doc.id}
                  onClick={() => setSelectedDocId(doc.id)}
                  className={`flex items-center justify-between gap-2 p-2 rounded-md border cursor-pointer transition-colors ${
                    isSelected
                      ? 'border-slate-900 bg-slate-50'
                      : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {doc.thumbnailDataUrl ? (
                      <img
                        src={doc.thumbnailDataUrl}
                        alt={doc.fileName}
                        className="w-10 h-8 object-cover rounded border border-slate-200 shrink-0"
                      />
                    ) : (
                      <div className="w-10 h-8 rounded border border-slate-200 bg-slate-100 flex items-center justify-center shrink-0">
                        <FileText className="w-4 h-4 text-slate-500" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-slate-900 truncate">
                        {doc.label || 'Scanned Doc'}
                      </div>
                      <div className="text-[10px] text-slate-500 truncate font-mono-num">
                        {doc.fileName} · {formatFileSize(doc.fileSize)}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveDoc(doc.id);
                    }}
                    title="Remove attached scan"
                    className="p-1 text-slate-400 hover:text-red-700 rounded hover:bg-red-50 shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </aside>
  );
}
