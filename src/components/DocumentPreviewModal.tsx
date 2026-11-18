import React, { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Image as ImageIcon,
  Loader2,
  RotateCw,
  Share2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  downloadDocumentBlob,
  formatFileSize,
  getDocumentBlob,
} from '../services/documentBlobStore';
import { CustomerDocument } from '../types/treasury';
import { formatAuditTimestamp } from '../utils/auditHelpers';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface DocumentPreviewModalProps {
  documentItem: CustomerDocument;
  onClose: () => void;
  onShareWhatsApp?: (doc: CustomerDocument) => void;
}

export function DocumentPreviewModal({
  documentItem,
  onClose,
  onShareWhatsApp,
}: DocumentPreviewModalProps) {
  const isPdf =
    documentItem.mimeType === 'application/pdf' ||
    documentItem.fileName.toLowerCase().endsWith('.pdf');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number>(100);
  const [rotation, setRotation] = useState<number>(0);

  // PDF state
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [renderingPage, setRenderingPage] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    let loadedPdf: pdfjsLib.PDFDocumentProxy | null = null;

    async function loadDocument() {
      setLoading(true);
      setError(null);
      setPdfDoc(null);
      setImageUrl(null);
      setCurrentPage(1);
      setZoom(100);
      setRotation(0);

      try {
        const blob = await getDocumentBlob(documentItem.id);
        if (!active) return;

        if (!blob) {
          setError(
            'Document binary file was not found in browser storage. Please re-upload or use Download.'
          );
          setLoading(false);
          return;
        }

        if (isPdf) {
          const buffer = await blob.arrayBuffer();
          if (!active) return;
          const loadingTask = pdfjsLib.getDocument({ data: buffer });
          loadedPdf = await loadingTask.promise;
          if (!active) {
            await loadingTask.destroy();
            return;
          }
          setPdfDoc(loadedPdf);
          setTotalPages(loadedPdf.numPages || 1);
          setLoading(false);
        } else {
          objectUrl = URL.createObjectURL(blob);
          setImageUrl(objectUrl);
          setLoading(false);
        }
      } catch (err) {
        if (!active) return;
        setError(
          err instanceof Error
            ? `Unable to preview document: ${err.message}`
            : 'Unable to preview document in browser.'
        );
        setLoading(false);
      }
    }

    loadDocument();

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      if (loadedPdf) {
        loadedPdf.cleanup().catch(() => {});
      }
    };
  }, [documentItem.id, isPdf]);

  // Render active PDF page onto canvas whenever page or zoom changes
  useEffect(() => {
    let cancelled = false;
    let renderTask: pdfjsLib.RenderTask | null = null;

    async function renderPdfPage() {
      if (!pdfDoc || !canvasRef.current) return;
      setRenderingPage(true);
      try {
        const page = await pdfDoc.getPage(currentPage);
        if (cancelled || !canvasRef.current) return;
        const scale = (zoom / 100) * 1.45;
        const viewport = page.getViewport({ scale, rotation });
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');
        if (!context) return;

        const outputScale = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        const transform =
          outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined;

        renderTask = page.render({
          canvasContext: context,
          canvas,
          viewport,
          transform,
        });
        await renderTask.promise;
      } catch {
        // Ignore cancelled render task errors
      } finally {
        if (!cancelled) setRenderingPage(false);
      }
    }

    renderPdfPage();

    return () => {
      cancelled = true;
      if (renderTask) {
        try {
          renderTask.cancel();
        } catch {
          // ignore
        }
      }
    };
  }, [pdfDoc, currentPage, zoom, rotation]);

  const handleDownload = async () => {
    await downloadDocumentBlob(documentItem.id, documentItem.fileName);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="doc-preview-title"
    >
      <div className="bg-white border border-slate-200 rounded-lg shadow-2xl w-full max-w-5xl h-[90vh] flex flex-col overflow-hidden">
        {/* Header Bar */}
        <div className="px-4 sm:px-6 py-3.5 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-9 h-9 rounded-md bg-[#0B192C] text-white flex items-center justify-center shrink-0 mt-0.5">
              {isPdf ? (
                <FileText className="w-4 h-4" aria-hidden="true" />
              ) : (
                <ImageIcon className="w-4 h-4" aria-hidden="true" />
              )}
            </div>
            <div className="min-w-0">
              <h3
                id="doc-preview-title"
                className="text-sm font-semibold text-slate-900 truncate"
              >
                {documentItem.title}
              </h3>
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-slate-500">
                <span className="font-medium text-slate-700">
                  {documentItem.docType}
                </span>
                <span aria-hidden="true">·</span>
                <span>{documentItem.customerName}</span>
                {documentItem.linkedChequeNumber && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono-num text-slate-700">
                      Chq #{documentItem.linkedChequeNumber}
                    </span>
                  </>
                )}
                <span aria-hidden="true">·</span>
                <span className="font-mono-num">
                  {formatFileSize(documentItem.fileSize)}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {onShareWhatsApp && (
              <button
                type="button"
                onClick={() => onShareWhatsApp(documentItem)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-md transition-colors whitespace-nowrap"
              >
                <Share2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Share via WhatsApp</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleDownload}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md transition-colors whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Download</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-500 hover:text-slate-900 rounded hover:bg-slate-200/70"
              aria-label="Close document preview"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Viewer Controls Toolbar */}
        <div className="px-4 sm:px-6 py-2 border-b border-slate-200 bg-white flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
          <div className="flex flex-wrap items-center gap-2 text-slate-600">
            <span className="font-mono-num text-[11px] text-slate-500">
              {documentItem.fileName}
            </span>
            <span className="text-slate-300" aria-hidden="true">
              |
            </span>
            <span className="text-[11px]">
              Uploaded {formatAuditTimestamp(documentItem.uploadedAt)} by{' '}
              <strong className="font-medium text-slate-800">
                {documentItem.uploadedBy}
              </strong>
            </span>
          </div>

          <div className="flex items-center gap-2">
            {isPdf && pdfDoc && (
              <div className="flex items-center gap-1 pr-2 mr-1 border-r border-slate-200">
                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                  aria-label="Previous PDF page"
                  className="p-1 border border-slate-300 rounded hover:bg-slate-100 disabled:opacity-40"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <span className="font-mono-num text-[11px] px-1.5 text-slate-700">
                  Page {currentPage} / {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setCurrentPage((p) => Math.min(totalPages, p + 1))
                  }
                  disabled={currentPage >= totalPages}
                  aria-label="Next PDF page"
                  className="p-1 border border-slate-300 rounded hover:bg-slate-100 disabled:opacity-40"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(50, z - 25))}
              disabled={zoom <= 50}
              aria-label="Zoom out"
              className="p-1 border border-slate-300 rounded hover:bg-slate-100 disabled:opacity-40"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setZoom(100)}
              className="px-2 py-0.5 text-[11px] font-mono-num font-medium text-slate-700 border border-slate-300 rounded hover:bg-slate-100"
              title="Reset zoom to 100%"
            >
              {zoom}%
            </button>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(300, z + 25))}
              disabled={zoom >= 300}
              aria-label="Zoom in"
              className="p-1 border border-slate-300 rounded hover:bg-slate-100 disabled:opacity-40"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={() => setRotation((r) => (r + 90) % 360)}
              aria-label="Rotate 90 degrees"
              title="Rotate 90°"
              className="p-1 border border-slate-300 rounded hover:bg-slate-100 ml-1"
            >
              <RotateCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Preview Stage */}
        <div className="flex-1 bg-slate-100 overflow-auto p-4 sm:p-6 flex items-start justify-center">
          {loading ? (
            <div className="self-center flex flex-col items-center gap-2 text-slate-600 text-xs">
              <Loader2 className="w-6 h-6 animate-spin text-slate-700" />
              <span>Loading document preview...</span>
            </div>
          ) : error ? (
            <div className="self-center max-w-md bg-white border border-red-200 rounded-md p-5 text-center space-y-2">
              <p className="text-xs font-semibold text-red-800">{error}</p>
              <button
                type="button"
                onClick={handleDownload}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download File</span>
              </button>
            </div>
          ) : isPdf ? (
            <div className="relative bg-white border border-slate-300 shadow-sm p-2">
              {renderingPage && (
                <div className="absolute inset-0 bg-white/60 flex items-center justify-center z-10">
                  <Loader2 className="w-5 h-5 animate-spin text-slate-700" />
                </div>
              )}
              <canvas ref={canvasRef} className="block max-w-none" />
            </div>
          ) : imageUrl ? (
            <div className="flex items-center justify-center min-h-full">
              <img
                src={imageUrl}
                alt={documentItem.title}
                style={{
                  width: `${zoom}%`,
                  maxWidth: zoom <= 100 ? '100%' : 'none',
                  transform: rotation ? `rotate(${rotation}deg)` : undefined,
                  transition: 'width 120ms ease, transform 150ms ease',
                }}
                className="bg-white border border-slate-300 shadow-sm object-contain"
              />
            </div>
          ) : null}
        </div>

        {/* Optional Note Footer */}
        {documentItem.note && (
          <div className="px-4 sm:px-6 py-2.5 border-t border-slate-200 bg-slate-50 text-xs text-slate-700 shrink-0">
            <strong className="font-semibold text-slate-900">Note: </strong>
            {documentItem.note}
          </div>
        )}
      </div>
    </div>
  );
}
