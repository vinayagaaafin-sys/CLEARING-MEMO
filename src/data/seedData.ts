import { TreasuryState } from '../types/treasury';
import { getDefaultIndianBankHolidays } from '../utils/bankHolidays';

export const SEED_TREASURY_STATE: TreasuryState = {
  activeCompanyId: 'comp-default',
  companies: [
    {
      id: 'comp-default',
      profile: {
        companyName: 'Your Company Name',
        registeredAddress: '',
        pan: '',
        gstin: '',
        cin: '',
        contactPhone: '',
        treasuryEmail: '',
        defaultMaker: 'Maker',
        defaultChecker: 'Checker',
        checkerPassword: '',
        signatory1Name: '',
        signatory1Designation: '',
        signatory2Name: '',
        signatory2Designation: '',
      },
      bankAccounts: [],
      batches: [],
      activeBatchId: '',
      cheques: [],
      customers: [],
      documents: [],
      letters: [],
      chequeSchedules: [],
      bankHolidays: getDefaultIndianBankHolidays(),
    },
  ],
  auditLogs: [],
};
