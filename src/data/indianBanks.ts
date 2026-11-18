export interface IndianBankPreset {
  name: string;
  shortCode: string;
  micrBankCode: string; // digits 4-6 of 9-digit MICR
  sampleBranch: string;
  sampleMicr: string;
}

export const MAJOR_INDIAN_BANKS: IndianBankPreset[] = [
  {
    name: 'HDFC Bank Ltd.',
    shortCode: 'HDFC',
    micrBankCode: '240',
    sampleBranch: 'Fort Corporate, Mumbai',
    sampleMicr: '400240002',
  },
  {
    name: 'ICICI Bank Ltd.',
    shortCode: 'ICICI',
    micrBankCode: '229',
    sampleBranch: 'Nariman Point, Mumbai',
    sampleMicr: '400229004',
  },
  {
    name: 'State Bank of India',
    shortCode: 'SBI',
    micrBankCode: '002',
    sampleBranch: 'Mumbai Main Branch',
    sampleMicr: '400002010',
  },
  {
    name: 'Axis Bank Ltd.',
    shortCode: 'AXIS',
    micrBankCode: '211',
    sampleBranch: 'Worli Corporate, Mumbai',
    sampleMicr: '400211018',
  },
  {
    name: 'Kotak Mahindra Bank Ltd.',
    shortCode: 'KOTAK',
    micrBankCode: '485',
    sampleBranch: 'BKC Treasury Hub, Mumbai',
    sampleMicr: '400485003',
  },
  {
    name: 'IndusInd Bank Ltd.',
    shortCode: 'INDUSIND',
    micrBankCode: '234',
    sampleBranch: 'Opera House, Mumbai',
    sampleMicr: '400234002',
  },
  {
    name: 'Punjab National Bank',
    shortCode: 'PNB',
    micrBankCode: '024',
    sampleBranch: 'PNB House, Fort, Mumbai',
    sampleMicr: '400024007',
  },
  {
    name: 'Bank of Baroda',
    shortCode: 'BOB',
    micrBankCode: '012',
    sampleBranch: 'Bandra Kurla Complex',
    sampleMicr: '400012045',
  },
  {
    name: 'Canara Bank',
    shortCode: 'CANARA',
    micrBankCode: '015',
    sampleBranch: 'Tamarind Lane, Fort',
    sampleMicr: '400015012',
  },
  {
    name: 'IDFC FIRST Bank Ltd.',
    shortCode: 'IDFC',
    micrBankCode: '751',
    sampleBranch: 'Naman Chambers, BKC',
    sampleMicr: '400751002',
  },
  {
    name: 'Yes Bank Ltd.',
    shortCode: 'YES',
    micrBankCode: '532',
    sampleBranch: 'Lower Parel, Mumbai',
    sampleMicr: '400532005',
  },
  {
    name: 'Federal Bank Ltd.',
    shortCode: 'FEDERAL',
    micrBankCode: '049',
    sampleBranch: 'Veer Nariman Road, Mumbai',
    sampleMicr: '400049003',
  },
];

export const BOUNCE_REASONS: string[] = [
  '01 - Funds Insufficient',
  '02 - Exceeds Arrangement',
  '03 - Effects Not Cleared, Present Again',
  '10 - Drawer Signature Differs',
  '11 - Alteration / Correction Requires Authentication',
  '16 - Stale Cheque (Exceeds 90 Days)',
  '17 - Post-Dated Cheque (PDC)',
  '20 - Account Closed',
  '21 - Payment Stopped by Drawer',
  '31 - Instrument Undated / Incomplete',
  '41 - Payee Endorsement Irregular',
];
