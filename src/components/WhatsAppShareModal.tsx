import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Copy,
  ExternalLink,
  MessageCircle,
  Phone,
  Share2,
  Smartphone,
  X,
} from 'lucide-react';
import { getDocumentBlob } from '../services/documentBlobStore';
import { CustomerDocument, CustomerProfile } from '../types/treasury';
import {
  buildWhatsAppShareMessage,
  normalizeWhatsAppPhone,
} from '../utils/customerHelpers';

interface WhatsAppShareModalProps {
  companyId: string;
  companyName: string;
  customer: CustomerProfile;
  documents: CustomerDocument[];
  onClose: () => void;
  onSaveCustomerMobile?: (newMobile: string) => void;
  onRecordShare: (params: {
    documents: CustomerDocument[];
    recipientPhone: string;
    channel: 'WhatsApp Web' | 'Direct File Share' | 'Copy Link';
  }) => void;
}

export function WhatsAppShareModal({
  companyId,
  companyName,
  customer,
  documents,
  onClose,
  onSaveCustomerMobile,
  onRecordShare,
}: WhatsAppShareModalProps) {
  const [phoneInput, setPhoneInput] = useState(customer.mobileNumber || '');
  const [saveMobileToProfile, setSaveMobileToProfile] = useState(
    !customer.mobileNumber
  );
  const [messageText, setMessageText] = useState(() =>
    buildWhatsAppShareMessage({
      companyName,
      customerName: customer.partyName,
      documents,
      companyId,
    })
  );
  const [copiedNotice, setCopiedNotice] = useState(false);
  const [webShareNotice, setWebShareNotice] = useState<string | null>(null);
  const [sharingFiles, setSharingFiles] = useState(false);

  useEffect(() => {
    setMessageText(
      buildWhatsAppShareMessage({
        companyName,
        customerName: customer.partyName,
        documents,
        companyId,
      })
    );
  }, [companyId, companyName, customer.partyName, documents]);

  const sanitizedWaDigits = useMemo(
    () => normalizeWhatsAppPhone(phoneInput),
    [phoneInput]
  );

  const whatsappUrl = useMemo(() => {
    const encodedText = encodeURIComponent(messageText);
    if (sanitizedWaDigits) {
      return `https://wa.me/${sanitizedWaDigits}?text=${encodedText}`;
    }
    return `https://wa.me/?text=${encodedText}`;
  }, [sanitizedWaDigits, messageText]);

  const maybePersistPhone = () => {
    const trimmed = phoneInput.trim();
    if (
      saveMobileToProfile &&
      trimmed &&
      trimmed !== (customer.mobileNumber || '').trim() &&
      onSaveCustomerMobile
    ) {
      onSaveCustomerMobile(trimmed);
    }
  };

  const handleWhatsAppClick = () => {
    maybePersistPhone();
    onRecordShare({
      documents,
      recipientPhone: phoneInput.trim() || 'Unspecified Recipient',
      channel: 'WhatsApp Web',
    });
  };

  const handleCopyMessage = async () => {
    try {
      await navigator.clipboard.writeText(messageText);
      maybePersistPhone();
      onRecordShare({
        documents,
        recipientPhone: phoneInput.trim() || 'Clipboard Copy',
        channel: 'Copy Link',
      });
      setCopiedNotice(true);
      setTimeout(() => setCopiedNotice(false), 2500);
    } catch {
      setWebShareNotice(
        'Clipboard access was blocked by the browser. Please select and copy the message manually.'
      );
    }
  };

  const handleDirectWebShare = async () => {
    setWebShareNotice(null);
    if (typeof navigator === 'undefined' || !navigator.share) {
      setWebShareNotice(
        'Direct OS file sharing is not supported in this desktop browser. Use "Send via WhatsApp Web" above or copy the message link.'
      );
      return;
    }

    setSharingFiles(true);
    try {
      const files: File[] = [];
      for (const doc of documents) {
        const blob = await getDocumentBlob(doc.id);
        if (blob) {
          files.push(
            new File([blob], doc.fileName, {
              type: doc.mimeType || blob.type || 'application/octet-stream',
            })
          );
        }
      }

      const canShareWithFiles =
        files.length > 0 &&
        typeof navigator.canShare === 'function' &&
        navigator.canShare({ files });

      if (canShareWithFiles) {
        await navigator.share({
          title:
            documents.length === 1
              ? documents[0].title
              : `${documents.length} Customer Documents — ${customer.partyName}`,
          text: messageText,
          files,
        });
      } else {
        await navigator.share({
          title:
            documents.length === 1
              ? documents[0].title
              : `${documents.length} Customer Documents — ${customer.partyName}`,
          text: messageText,
        });
      }

      maybePersistPhone();
      onRecordShare({
        documents,
        recipientPhone: phoneInput.trim() || 'Mobile Share Sheet',
        channel: 'Direct File Share',
      });
      onClose();
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        setWebShareNotice(
          'Browser share sheet is restricted in this embedded frame. Use "Send via WhatsApp Web" above to send directly.'
        );
      }
    } finally {
      setSharingFiles(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wa-share-modal-title"
    >
      <div className="bg-white border border-slate-200 rounded-lg shadow-2xl w-full max-w-xl overflow-hidden flex flex-col max-h-[92vh]">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-md bg-emerald-700 text-white flex items-center justify-center">
              <MessageCircle className="w-4 h-4" aria-hidden="true" />
            </div>
            <div>
              <h3
                id="wa-share-modal-title"
                className="text-sm font-semibold text-slate-900"
              >
                Share Document{documents.length > 1 ? 's' : ''} via WhatsApp
              </h3>
              <p className="text-xs text-slate-500">
                {customer.partyName} · {documents.length}{' '}
                {documents.length === 1 ? 'document' : 'documents'} selected
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-700 rounded"
            aria-label="Close WhatsApp share modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto text-xs">
          {/* Selected Documents Summary */}
          <div className="bg-slate-50 border border-slate-200 rounded-md p-3 space-y-1.5">
            <div className="text-[11px] font-semibold text-slate-600 uppercase tracking-wide">
              Document{documents.length > 1 ? 's' : ''} Included
            </div>
            <ul className="space-y-1">
              {documents.map((doc) => (
                <li
                  key={doc.id}
                  className="flex items-center justify-between gap-2 text-xs text-slate-800"
                >
                  <span className="font-medium truncate">
                    {doc.title}{' '}
                    <span className="text-slate-500 font-normal">
                      ({doc.docType})
                    </span>
                  </span>
                  {doc.linkedChequeNumber && (
                    <span className="font-mono-num text-[11px] text-slate-600 shrink-0">
                      Chq #{doc.linkedChequeNumber}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {/* Recipient WhatsApp Mobile Number */}
          <div className="space-y-1.5">
            <label
              htmlFor="wa-mobile-input"
              className="block text-xs font-semibold text-slate-800"
            >
              Recipient WhatsApp Mobile Number
            </label>
            <div className="relative">
              <Phone
                className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2"
                aria-hidden="true"
              />
              <input
                id="wa-mobile-input"
                type="tel"
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                placeholder="+91 98200 12345"
                className="w-full pl-9 pr-3 py-2 text-sm font-mono-num border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
              <span>
                {customer.mobileNumber
                  ? `Auto-filled from ${customer.partyName}'s saved mobile`
                  : 'No saved mobile yet — enter number or leave blank to choose contact in WhatsApp'}
              </span>
              {sanitizedWaDigits && (
                <span className="font-mono-num text-emerald-700 font-medium">
                  wa.me/{sanitizedWaDigits}
                </span>
              )}
            </div>
            {onSaveCustomerMobile &&
              phoneInput.trim() &&
              phoneInput.trim() !== (customer.mobileNumber || '').trim() && (
                <label className="inline-flex items-center gap-2 pt-1 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={saveMobileToProfile}
                    onChange={(e) => setSaveMobileToProfile(e.target.checked)}
                    className="rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                  />
                  <span>Save this mobile number to Customer Profile</span>
                </label>
              )}
          </div>

          {/* Pre-filled Message Preview */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label
                htmlFor="wa-message-textarea"
                className="block text-xs font-semibold text-slate-800"
              >
                Pre-filled WhatsApp Message (Editable)
              </label>
              <button
                type="button"
                onClick={handleCopyMessage}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 hover:text-slate-900"
              >
                {copiedNotice ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-700" />
                    <span className="text-emerald-700">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" />
                    <span>Copy Message &amp; Link</span>
                  </>
                )}
              </button>
            </div>
            <textarea
              id="wa-message-textarea"
              rows={7}
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              className="w-full px-3 py-2 text-xs leading-relaxed border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-900/15 font-sans"
            />
          </div>

          {webShareNotice && (
            <div className="px-3 py-2 bg-amber-50 border border-amber-200 rounded-md text-[11px] text-amber-900">
              {webShareNotice}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2.5">
          <button
            type="button"
            onClick={handleDirectWebShare}
            disabled={sharingFiles}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-100 transition-colors"
            title="Attach actual file via device Web Share sheet (best on mobile)"
          >
            <Smartphone className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{sharingFiles ? 'Preparing File...' : 'Share File (Web Share)'}</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
            >
              Close
            </button>
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={handleWhatsAppClick}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-md transition-colors whitespace-nowrap"
            >
              <Share2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Send via WhatsApp</span>
              <ExternalLink className="w-3 h-3 opacity-80" aria-hidden="true" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
