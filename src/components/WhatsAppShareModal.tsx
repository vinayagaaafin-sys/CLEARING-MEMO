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
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#102A43]/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wa-share-modal-title"
    >
      <div className="bg-white border border-[#D9E2EC] rounded-lg shadow-2xl w-full max-w-xl overflow-hidden flex flex-col max-h-[92vh]">
        <div className="px-6 py-4 border-b border-[#D9E2EC] bg-[#F4F7FA] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-md bg-[#16A34A] text-white flex items-center justify-center">
              <MessageCircle className="w-4 h-4" aria-hidden="true" />
            </div>
            <div>
              <h3
                id="wa-share-modal-title"
                className="text-sm font-semibold text-[#102A43]"
              >
                Share Document{documents.length > 1 ? 's' : ''} via WhatsApp
              </h3>
              <p className="text-xs text-[#627D98]">
                {customer.partyName} · {documents.length}{' '}
                {documents.length === 1 ? 'document' : 'documents'} selected
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-[#627D98] hover:text-[#102A43] rounded"
            aria-label="Close WhatsApp share modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto text-xs">
          {/* Selected Documents Summary */}
          <div className="bg-[#F4F7FA] border border-[#D9E2EC] rounded-md p-3 space-y-1.5">
            <div className="text-[11px] font-semibold text-[#627D98] uppercase tracking-wide">
              Document{documents.length > 1 ? 's' : ''} Included
            </div>
            <ul className="space-y-1">
              {documents.map((doc) => (
                <li
                  key={doc.id}
                  className="flex items-center justify-between gap-2 text-xs text-[#102A43]"
                >
                  <span className="font-medium truncate">
                    {doc.title}{' '}
                    <span className="text-[#627D98] font-normal">
                      ({doc.docType})
                    </span>
                  </span>
                  {doc.linkedChequeNumber && (
                    <span className="font-mono-num text-[11px] text-[#176B87] shrink-0">
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
              className="block text-xs font-semibold text-[#102A43]"
            >
              Recipient WhatsApp Mobile Number
            </label>
            <div className="relative">
              <Phone
                className="w-3.5 h-3.5 text-[#627D98] absolute left-3 top-1/2 -translate-y-1/2"
                aria-hidden="true"
              />
              <input
                id="wa-mobile-input"
                type="tel"
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                placeholder="+91 98200 12345"
                className="w-full pl-9 pr-3 py-2 text-sm font-mono-num border border-[#D9E2EC] rounded-md bg-white text-[#102A43] placeholder:text-[#627D98] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#627D98]">
              <span>
                {customer.mobileNumber
                  ? `Auto-filled from ${customer.partyName}'s saved mobile`
                  : 'No saved mobile yet — enter number or leave blank to choose contact in WhatsApp'}
              </span>
              {sanitizedWaDigits && (
                <span className="font-mono-num text-[#16A34A] font-medium">
                  wa.me/{sanitizedWaDigits}
                </span>
              )}
            </div>
            {onSaveCustomerMobile &&
              phoneInput.trim() &&
              phoneInput.trim() !== (customer.mobileNumber || '').trim() && (
                <label className="inline-flex items-center gap-2 pt-1 text-xs text-[#243B53] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={saveMobileToProfile}
                    onChange={(e) => setSaveMobileToProfile(e.target.checked)}
                    className="rounded border-[#D9E2EC] text-[#14B8A6] focus:ring-[#14B8A6]"
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
                className="block text-xs font-semibold text-[#102A43]"
              >
                Pre-filled WhatsApp Message (Editable)
              </label>
              <button
                type="button"
                onClick={handleCopyMessage}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-[#176B87] hover:text-[#102A43]"
              >
                {copiedNotice ? (
                  <>
                    <Check className="w-3 h-3 text-[#16A34A]" />
                    <span className="text-[#16A34A]">Copied</span>
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
              className="w-full px-3 py-2 text-xs leading-relaxed border border-[#D9E2EC] rounded-md bg-white text-[#102A43] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87] font-sans"
            />
          </div>

          {webShareNotice && (
            <div className="px-3 py-2 bg-[#F59E0B]/10 border border-[#F59E0B]/35 rounded-md text-[11px] text-[#102A43]">
              {webShareNotice}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-[#D9E2EC] bg-[#F4F7FA] flex flex-wrap items-center justify-between gap-2.5">
          <button
            type="button"
            onClick={handleDirectWebShare}
            disabled={sharingFiles}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#243B53] bg-white border border-[#D9E2EC] rounded-md hover:bg-[#F4F7FA] transition-colors"
            title="Attach actual file via device Web Share sheet (best on mobile)"
          >
            <Smartphone className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{sharingFiles ? 'Preparing File...' : 'Share File (Web Share)'}</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 text-xs font-medium text-[#243B53] bg-white border border-[#D9E2EC] rounded-md hover:bg-[#F4F7FA]"
            >
              Close
            </button>
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={handleWhatsAppClick}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#16A34A] hover:bg-[#15803D] rounded-md transition-colors whitespace-nowrap"
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
