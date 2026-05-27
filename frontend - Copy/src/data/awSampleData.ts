// Real AdventureWorks sample data keyed by entity name.
// Used by DataExplorer (real rows instead of generated mock data) and
// DataSourcesView (Download sample buttons on AWSourcesPanel).

export type AWEntityName =
  | 'Customer'
  | 'SalesOrder'
  | 'SalesOrderLine'
  | 'Product'
  | 'Salesperson'
  | 'Employee'
  | 'Territory'
  | 'Offer'

export const AW_SAMPLE_DATA: Record<AWEntityName, Record<string, unknown>[]> = {
  Territory: [
    { territoryId: 1,  name: 'Northwest',      countryRegion: 'US', group: 'North America', salesYTD: 7887186.79  },
    { territoryId: 2,  name: 'Northeast',       countryRegion: 'US', group: 'North America', salesYTD: 2402176.85  },
    { territoryId: 3,  name: 'Central',         countryRegion: 'US', group: 'North America', salesYTD: 3072175.12  },
    { territoryId: 4,  name: 'Southwest',       countryRegion: 'US', group: 'North America', salesYTD: 10510853.87 },
    { territoryId: 5,  name: 'Southeast',       countryRegion: 'US', group: 'North America', salesYTD: 2538667.25  },
    { territoryId: 6,  name: 'Canada',          countryRegion: 'CA', group: 'North America', salesYTD: 6771829.14  },
    { territoryId: 7,  name: 'France',          countryRegion: 'FR', group: 'Europe',        salesYTD: 4772398.31  },
    { territoryId: 8,  name: 'Germany',         countryRegion: 'DE', group: 'Europe',        salesYTD: 3805202.35  },
    { territoryId: 9,  name: 'Australia',       countryRegion: 'AU', group: 'Pacific',       salesYTD: 5977814.92  },
    { territoryId: 10, name: 'United Kingdom',  countryRegion: 'GB', group: 'Europe',        salesYTD: 5012905.37  },
  ],

  Offer: [
    { offerId: 1,  description: 'No Discount',                  discountPct: 0.00, type: 'No Discount',          minQty: 0,  maxQty: null },
    { offerId: 2,  description: 'Volume Discount 11 to 14',     discountPct: 0.02, type: 'Volume Discount',      minQty: 11, maxQty: 14   },
    { offerId: 3,  description: 'Volume Discount 15 to 24',     discountPct: 0.05, type: 'Volume Discount',      minQty: 15, maxQty: 24   },
    { offerId: 4,  description: 'Volume Discount 25 to 40',     discountPct: 0.10, type: 'Volume Discount',      minQty: 25, maxQty: 40   },
    { offerId: 5,  description: 'Volume Discount 41 to 60',     discountPct: 0.15, type: 'Volume Discount',      minQty: 41, maxQty: 60   },
    { offerId: 6,  description: 'Volume Discount over 60',      discountPct: 0.20, type: 'Volume Discount',      minQty: 61, maxQty: null },
    { offerId: 7,  description: 'Mountain-100 Clearance Sale',  discountPct: 0.35, type: 'Discontinued Product', minQty: 0,  maxQty: null },
    { offerId: 8,  description: 'Sport Helmet Discount-2002',   discountPct: 0.10, type: 'Seasonal Discount',    minQty: 0,  maxQty: null },
    { offerId: 9,  description: 'Road-650 Overstock',           discountPct: 0.30, type: 'Excess Inventory',     minQty: 0,  maxQty: null },
    { offerId: 10, description: 'Mountain Tire Sale',           discountPct: 0.50, type: 'Excess Inventory',     minQty: 0,  maxQty: null },
  ],

  SalesOrder: [
    { orderId: 43659, orderDate: '2011-05-31', shipDate: '2011-06-07', status: 'Shipped',    subtotalAmount: 20565.62, totalDue: 23153.23, onlineOrderFlag: false },
    { orderId: 43660, orderDate: '2011-05-31', shipDate: '2011-06-07', status: 'Shipped',    subtotalAmount:  1294.25, totalDue:  1457.33, onlineOrderFlag: false },
    { orderId: 43661, orderDate: '2011-05-31', shipDate: '2011-06-07', status: 'Shipped',    subtotalAmount: 32726.48, totalDue: 36865.80, onlineOrderFlag: false },
    { orderId: 43662, orderDate: '2011-05-31', shipDate: '2011-06-07', status: 'Shipped',    subtotalAmount: 28832.53, totalDue: 32474.93, onlineOrderFlag: false },
    { orderId: 75117, orderDate: '2014-11-30', shipDate: '2014-12-07', status: 'Shipped',    subtotalAmount:     9.99, totalDue:    13.07, onlineOrderFlag: true  },
    { orderId: 75118, orderDate: '2014-11-30', shipDate: '2014-12-07', status: 'Processing', subtotalAmount:  1429.00, totalDue:  1532.21, onlineOrderFlag: true  },
    { orderId: 75119, orderDate: '2014-11-30', shipDate: '2014-12-07', status: 'Processing', subtotalAmount:  2039.99, totalDue:  2185.98, onlineOrderFlag: true  },
    { orderId: 75120, orderDate: '2014-12-01', shipDate: '2014-12-08', status: 'Processing', subtotalAmount:  2049.00, totalDue:  2193.15, onlineOrderFlag: false },
    { orderId: 75121, orderDate: '2014-12-01', shipDate: '2014-12-08', status: 'Shipped',    subtotalAmount:    48.68, totalDue:    52.18, onlineOrderFlag: true  },
    { orderId: 75122, orderDate: '2014-12-01', shipDate: '2014-12-08', status: 'Shipped',    subtotalAmount:  1898.00, totalDue:  2031.62, onlineOrderFlag: false },
    { orderId: 75123, orderDate: '2014-12-28', shipDate: null,         status: 'Confirmed',  subtotalAmount: 87145.20, totalDue: 93345.65, onlineOrderFlag: false },
    { orderId: 75124, orderDate: '2014-12-28', shipDate: null,         status: 'Confirmed',  subtotalAmount: 53209.80, totalDue: 56994.49, onlineOrderFlag: false },
  ],

  SalesOrderLine: [
    { lineId: 4365901, quantity: 1, unitPrice: 2024.99, lineTotal:   2024.99, offerRef: 1 },
    { lineId: 4365902, quantity: 3, unitPrice: 2024.99, lineTotal:   6074.98, offerRef: 1 },
    { lineId: 4365903, quantity: 1, unitPrice: 2039.99, lineTotal:   2039.99, offerRef: 1 },
    { lineId: 4365904, quantity: 1, unitPrice: 2039.99, lineTotal:   2039.99, offerRef: 1 },
    { lineId: 4365905, quantity: 2, unitPrice: 2039.99, lineTotal:   4079.99, offerRef: 1 },
    { lineId: 4366101, quantity: 1, unitPrice: 32726.48, lineTotal: 32726.48, offerRef: 1 },
    { lineId: 7512101, quantity: 1, unitPrice:     9.99, lineTotal:     9.99, offerRef: 4 },
    { lineId: 7512201, quantity: 5, unitPrice:  1429.00, lineTotal:  7145.00, offerRef: 6 },
    { lineId: 7511701, quantity: 2, unitPrice:  2039.99, lineTotal:  4079.98, offerRef: 1 },
    { lineId: 7511801, quantity: 1, unitPrice:  2049.00, lineTotal:  2049.00, offerRef: 2 },
    { lineId: 7512301, quantity: 3, unitPrice: 87145.20, lineTotal: 261435.60, offerRef: 4 },
    { lineId: 7512401, quantity: 2, unitPrice: 53209.80, lineTotal: 106419.60, offerRef: 3 },
  ],

  Product: [
    { internalId: 1,   name: 'Adjustable Race',             category: 'Components',  subcategory: null,     listPrice: null,  color: null    },
    { internalId: 316, name: 'Blade',                       category: 'Components',  subcategory: null,     listPrice: 0.00,  color: null    },
    { internalId: 707, name: 'Sport-100 Helmet Blue',       category: 'Accessories', subcategory: 'Helmets', listPrice: 34.99, color: 'Blue'  },
    { internalId: 708, name: 'Sport-100 Helmet Black',      category: 'Accessories', subcategory: 'Helmets', listPrice: 34.99, color: 'Black' },
    { internalId: 709, name: 'Mountain Bike Socks M',       category: 'Clothing',    subcategory: 'Socks',   listPrice: 9.50,  color: 'White' },
    { internalId: 710, name: 'Mountain Bike Socks L',       category: 'Clothing',    subcategory: 'Socks',   listPrice: 9.50,  color: 'White' },
    { internalId: 711, name: 'Sport-100 Helmet Red',        category: 'Accessories', subcategory: 'Helmets', listPrice: 34.99, color: 'Red'   },
    { internalId: 712, name: 'AWC Logo Cap',                category: 'Accessories', subcategory: 'Caps',    listPrice: 8.99,  color: 'Multi' },
    { internalId: 713, name: 'Long-Sleeve Logo Jersey S',   category: 'Clothing',    subcategory: 'Jerseys', listPrice: 49.99, color: 'Multi' },
    { internalId: 714, name: 'Long-Sleeve Logo Jersey M',   category: 'Clothing',    subcategory: 'Jerseys', listPrice: 49.99, color: 'Multi' },
    { internalId: 715, name: 'Long-Sleeve Logo Jersey L',   category: 'Clothing',    subcategory: 'Jerseys', listPrice: 49.99, color: 'Multi' },
    { internalId: 716, name: 'Long-Sleeve Logo Jersey XL',  category: 'Clothing',    subcategory: 'Jerseys', listPrice: 49.99, color: 'Multi' },
  ],

  Salesperson: [
    { salesPersonId: 274, salesQuota: null,   bonus:   0.00, commissionPct: 0.000, salesYTD:  559697.56 },
    { salesPersonId: 275, salesQuota: 300000, bonus: 4100.00, commissionPct: 0.012, salesYTD: 3763178.18 },
    { salesPersonId: 276, salesQuota: 250000, bonus: 2000.00, commissionPct: 0.015, salesYTD: 4251368.55 },
    { salesPersonId: 277, salesQuota: 250000, bonus: 2500.00, commissionPct: 0.015, salesYTD: 3189418.37 },
    { salesPersonId: 278, salesQuota: 250000, bonus:  500.00, commissionPct: 0.010, salesYTD: 1453719.47 },
    { salesPersonId: 279, salesQuota: 300000, bonus: 6700.00, commissionPct: 0.010, salesYTD: 2315185.61 },
    { salesPersonId: 280, salesQuota: 250000, bonus: 5000.00, commissionPct: 0.010, salesYTD: 1352577.13 },
    { salesPersonId: 281, salesQuota: 250000, bonus: 3550.00, commissionPct: 0.010, salesYTD: 2458535.62 },
    { salesPersonId: 282, salesQuota: 250000, bonus: 5000.00, commissionPct: 0.015, salesYTD: 2604540.72 },
    { salesPersonId: 283, salesQuota: 250000, bonus: 3500.00, commissionPct: 0.012, salesYTD: 1573012.94 },
    { salesPersonId: 286, salesQuota: 250000, bonus: 5650.00, commissionPct: 0.018, salesYTD: 1421810.92 },
    { salesPersonId: 288, salesQuota: 250000, bonus:   75.00, commissionPct: 0.018, salesYTD: 1827066.71 },
    { salesPersonId: 289, salesQuota: 250000, bonus: 5150.00, commissionPct: 0.020, salesYTD: 4116871.23 },
    { salesPersonId: 290, salesQuota: 250000, bonus:  985.00, commissionPct: 0.016, salesYTD: 3121616.32 },
  ],

  Employee: [
    { matricolaDip:   1, cognome: 'Sánchez',    nome: 'Ken',     ruolo: 'Chief Executive Officer',      dataNascita: '1969-01-29', dataAssunzione: '2009-01-14' },
    { matricolaDip:   2, cognome: 'Duffy',       nome: 'Terri',   ruolo: 'Vice President of Engineering', dataNascita: '1971-08-01', dataAssunzione: '2008-01-31' },
    { matricolaDip:   3, cognome: 'Tamburello',  nome: 'Roberto', ruolo: 'Engineering Manager',           dataNascita: '1974-11-12', dataAssunzione: '2007-11-11' },
    { matricolaDip:   4, cognome: 'Walters',     nome: 'Rob',     ruolo: 'Senior Tool Designer',          dataNascita: '1974-12-23', dataAssunzione: '2007-12-05' },
    { matricolaDip:   5, cognome: 'Erickson',    nome: 'Gail',    ruolo: 'Design Engineer',               dataNascita: '1952-09-27', dataAssunzione: '2008-01-06' },
    { matricolaDip:   6, cognome: 'Goldberg',    nome: 'Jossef',  ruolo: 'Design Engineer',               dataNascita: '1959-03-11', dataAssunzione: '2008-01-24' },
    { matricolaDip:  16, cognome: 'Bradley',     nome: 'David',   ruolo: 'Marketing Manager',             dataNascita: '1975-03-19', dataAssunzione: '2007-12-20' },
    { matricolaDip:  17, cognome: 'Brown',       nome: 'Kevin',   ruolo: 'Marketing Assistant',           dataNascita: '1987-05-03', dataAssunzione: '2007-01-26' },
    { matricolaDip: 274, cognome: 'Ito',         nome: 'Shu',     ruolo: 'Sales Representative',          dataNascita: '1978-03-09', dataAssunzione: '2009-01-06' },
    { matricolaDip: 275, cognome: 'Saraiva',     nome: 'José',    ruolo: 'Sales Representative',          dataNascita: '1972-02-12', dataAssunzione: '2009-01-06' },
    { matricolaDip: 276, cognome: 'Mitchell',    nome: 'Linda',   ruolo: 'Sales Manager',                 dataNascita: '1969-12-14', dataAssunzione: '2009-01-06' },
    { matricolaDip: 277, cognome: 'Tsoflias',    nome: 'Lynn',    ruolo: 'Sales Representative',          dataNascita: '1977-02-09', dataAssunzione: '2009-01-06' },
    { matricolaDip: 278, cognome: 'Alberts',     nome: 'Pamela', ruolo: 'Sales Representative',           dataNascita: '1979-10-14', dataAssunzione: '2009-01-06' },
    { matricolaDip: 279, cognome: 'Pak',         nome: 'Jae',     ruolo: 'Sales Representative',          dataNascita: '1968-03-08', dataAssunzione: '2009-01-06' },
    { matricolaDip: 289, cognome: 'Reiter',      nome: 'Rachel',  ruolo: 'Sales Representative',          dataNascita: '1973-02-09', dataAssunzione: '2009-01-06' },
    { matricolaDip: 290, cognome: 'Vargas',      nome: 'Ranjit',  ruolo: 'Sales Representative',          dataNascita: '1975-07-01', dataAssunzione: '2009-01-06' },
  ],

  Customer: [
    { accountId: 29485, accountNumber: 'AW00029485', name: 'Bike World',                    customerType: 'Store',      territory: 'Northwest' },
    { accountId: 29521, accountNumber: 'AW00029521', name: 'Action Bicycle Specialists',    customerType: 'Store',      territory: 'Northwest' },
    { accountId: 29598, accountNumber: 'AW00029598', name: 'Riding Cycles',                 customerType: 'Store',      territory: 'Central'   },
    { accountId: 29672, accountNumber: 'AW00029672', name: 'Valley Bicycle Specialists',    customerType: 'Store',      territory: 'Northeast' },
    { accountId: 29734, accountNumber: 'AW00029734', name: 'Eastside Department Store',     customerType: 'Store',      territory: 'Canada'    },
    { accountId: 29825, accountNumber: 'AW00029825', name: 'Sporting Goods Store',          customerType: 'Store',      territory: 'Southeast' },
    { accountId: 29890, accountNumber: 'AW00029890', name: 'Bike Riders Company',           customerType: 'Store',      territory: 'Southwest' },
    { accountId: 29994, accountNumber: 'AW00029994', name: 'Metropolitan Bicycle Supply',   customerType: 'Store',      territory: 'Canada'    },
    { accountId: 30052, accountNumber: 'AW00030052', name: 'West Side Cycling',             customerType: 'Store',      territory: 'Northwest' },
    { accountId: 11000, accountNumber: 'AW00011000', name: 'Jon Yang',                      customerType: 'Individual', territory: 'Northwest' },
    { accountId: 11001, accountNumber: 'AW00011001', name: 'Eugene Huang',                  customerType: 'Individual', territory: 'Northwest' },
    { accountId: 11002, accountNumber: 'AW00011002', name: 'Ruben Torres',                  customerType: 'Individual', territory: 'Northwest' },
    { accountId: 11003, accountNumber: 'AW00011003', name: 'Christina Thielen',             customerType: 'Individual', territory: 'Northwest' },
    { accountId: 11004, accountNumber: 'AW00011004', name: 'Marcus Harrington',             customerType: 'Individual', territory: 'Southwest' },
  ],
}
