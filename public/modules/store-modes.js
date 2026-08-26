// ============================================================================
// VALENIXIA COMMERCE ECOSYSTEM - MULTI-INDUSTRY STORE MODES & DYNAMIC ADAPTATION ENGINE
// Version 2.9.0 — Reconfigures forms, fields, categories, and checkout terminology per industry
// ============================================================================

(function(globalScope) {
  'use strict';

  const STORE_MODES = {
    'simple-retail': {
      id: 'simple-retail',
      name: 'Simple Retail & General Store',
      icon: '',
      category: 'Retail',
      badge: 'Fast Checkout',
      subtitle: 'General store, convenience & retail shop with barcode scan-to-cart.',
      description: 'Optimized for instant point-of-sale scanning, fast stock counts, basic supplier tracking, and customer receipts.',
      customerLabel: 'Customer',
      itemLabel: 'Product',
      features: {
        hasBarcode: true,
        hasCostPrice: true,
        hasMinStock: true,
        hasVariants: false,
        hasBatchExpiry: false,
        hasSerialIMEI: false,
        hasWeightPricing: false,
        hasModifiers: false,
        hasJewelryKarat: false,
        hasAutoOEM: false,
        hasPrescriptionRx: false,
        hasPerishable: false,
        hasWholesaleTiers: false
      },
      defaultCategories: ['Beverages', 'Snacks & Confectionery', 'Packaged Foods', 'Household Goods', 'Toiletries', 'Stationery & Toys', 'General Merchandise'],
      sampleProducts: [
        { name: 'Mineral Water 1.5L', barcode: '896400012345', price: 100, cost: 75, stock: 48, category: 'Beverages', unit: 'Bottle' },
        { name: 'Potato Chips Masala 50g', barcode: '896400012346', price: 60, cost: 45, stock: 120, category: 'Snacks & Confectionery', unit: 'Pack' },
        { name: 'Dishwash Bar 250g', barcode: '896400012347', price: 140, cost: 110, stock: 35, category: 'Household Goods', unit: 'Pcs' }
      ]
    },

    'grocery-mart': {
      id: 'grocery-mart',
      name: 'Supermarket, Grocery & FMCG Mart',
      icon: '',
      category: 'Grocery',
      badge: 'Scale Ready',
      subtitle: 'Supermarket with loose weight scale calculation, batch dates, and multi-aisle categorisation.',
      description: 'Supports digital weight scales, price-by-weight (kg/g), loose produce, expiration date tracking, and bulk carton unpacking.',
      customerLabel: 'Customer',
      itemLabel: 'Grocery Item',
      features: {
        hasBarcode: true,
        hasCostPrice: true,
        hasMinStock: true,
        hasVariants: false,
        hasBatchExpiry: true,
        hasSerialIMEI: false,
        hasWeightPricing: true,
        hasModifiers: false,
        hasJewelryKarat: false,
        hasAutoOEM: false,
        hasPrescriptionRx: false,
        hasPerishable: true,
        hasWholesaleTiers: true
      },
      defaultCategories: ['Fresh Fruits & Vegetables', 'Dairy, Eggs & Cheese', 'Rice, Pulses & Grains', 'Spices & Cooking Oils', 'Beverages & Juices', 'Bakery & Bread', 'Cleaning & Detergents', 'Frozen Foods'],
      sampleProducts: [
        { name: 'Basmati Rice Premium (1kg)', barcode: '896400021001', price: 380, cost: 310, stock: 250, category: 'Rice, Pulses & Grains', unit: 'kg' },
        { name: 'Cooking Oil 1L Pouch', barcode: '896400021002', price: 540, cost: 480, stock: 80, category: 'Spices & Cooking Oils', unit: 'Pouch' },
        { name: 'Farm Fresh Farm Eggs (Dozen)', barcode: '896400021003', price: 320, cost: 270, stock: 60, category: 'Dairy, Eggs & Cheese', unit: 'Dozen' }
      ]
    },

    'clothing-fashion': {
      id: 'clothing-fashion',
      name: 'Apparel, Shoes & Fashion Boutique',
      icon: '',
      category: 'Fashion',
      badge: 'Matrix Variants',
      subtitle: 'Clothing and footwear with size (S/M/L/XL), color, fabric, and seasonal tagging.',
      description: 'Includes multi-variant matrix grids (Size × Color), barcode tag printing, fitting room holds, and seasonal discount campaigns.',
      customerLabel: 'VIP Client',
      itemLabel: 'Fashion Item',
      features: {
        hasBarcode: true,
        hasCostPrice: true,
        hasMinStock: true,
        hasVariants: true,
        hasBatchExpiry: false,
        hasSerialIMEI: false,
        hasWeightPricing: false,
        hasModifiers: false,
        hasJewelryKarat: false,
        hasAutoOEM: false,
        hasPrescriptionRx: false,
        hasPerishable: false,
        hasWholesaleTiers: false
      },
      defaultCategories: ['Men\'s Formal Wear', 'Men\'s Casual Shirts', 'Women\'s Stitched Kurtis', 'Women\'s Unstitched Suits', 'Denim & Trousers', 'Footwear & Shoes', 'Bags & Accessories', 'Kids Collection'],
      sampleProducts: [
        { name: 'Slim Fit Cotton Shirt (Navy Blue)', barcode: '896400031001', price: 2850, cost: 1600, stock: 45, category: 'Men\'s Casual Shirts', unit: 'Pcs', variants: 'S,M,L,XL' },
        { name: 'Embroidered Linen Kurti (Maroon)', barcode: '896400031002', price: 4200, cost: 2400, stock: 30, category: 'Women\'s Stitched Kurtis', unit: 'Pcs', variants: 'Small,Medium,Large' },
        { name: 'Leather Formal Shoes (Black)', barcode: '896400031003', price: 6500, cost: 3800, stock: 22, category: 'Footwear & Shoes', unit: 'Pair', variants: '40,41,42,43,44' }
      ]
    },

    'food-restaurant': {
      id: 'food-restaurant',
      name: 'Dine-In Restaurant, Pizzeria & Food Court',
      icon: '',
      category: 'Hospitality',
      badge: 'KDS & Tables',
      subtitle: 'Table dining, kitchen display (KDS), order modifiers, takeaway and bill splitting.',
      description: 'Manage table floorplans, kitchen order tickets (KOT), recipe add-ons (extra cheese, spicy), food delivery rider dispatch, and service charges.',
      customerLabel: 'Guest / Table',
      itemLabel: 'Menu Item',
      features: {
        hasBarcode: false,
        hasCostPrice: true,
        hasMinStock: false,
        hasVariants: false,
        hasBatchExpiry: false,
        hasSerialIMEI: false,
        hasWeightPricing: false,
        hasModifiers: true,
        hasJewelryKarat: false,
        hasAutoOEM: false,
        hasPrescriptionRx: false,
        hasPerishable: true,
        hasWholesaleTiers: false
      },
      defaultCategories: ['Starters & Appetizers', 'Burgers & Sandwiches', 'Handcrafted Pizzas', 'BBQ & Grills', 'Traditional Karahi & Handi', 'Pasta & Italian', 'Desserts & Ice Cream', 'Hot & Cold Beverages'],
      sampleProducts: [
        { name: 'Charcoal Gourmet Beef Burger', barcode: 'FOOD_001', price: 950, cost: 420, stock: 999, category: 'Burgers & Sandwiches', unit: 'Serving', modifiers: 'Cheese Slice, Jalapenos, Double Patty' },
        { name: 'Special Chicken Karahi (Full)', barcode: 'FOOD_002', price: 1850, cost: 950, stock: 999, category: 'Traditional Karahi & Handi', unit: 'Pot', modifiers: 'Desi Ghee, Extra Ginger' },
        { name: 'Pepperoni Classic Pizza 12"', barcode: 'FOOD_003', price: 1450, cost: 600, stock: 999, category: 'Handcrafted Pizzas', unit: 'Pie', modifiers: 'Stuffed Crust, Extra Cheese' }
      ]
    },

    'bakery-cafe': {
      id: 'bakery-cafe',
      name: 'Bakery, Café, Coffee Bar & Patisserie',
      icon: '',
      category: 'Hospitality',
      badge: 'Touch Speed',
      subtitle: 'Coffee espresso bar, artisan cakes, freshly baked goods, and ingredient tracking.',
      description: 'Fast-touch POS screen with syrup/milk modifiers, custom cake order booking, daily baking batch decay, and pastry counter display.',
      customerLabel: 'Guest',
      itemLabel: 'Bakery Item',
      features: {
        hasBarcode: false,
        hasCostPrice: true,
        hasMinStock: true,
        hasVariants: false,
        hasBatchExpiry: true,
        hasSerialIMEI: false,
        hasWeightPricing: true,
        hasModifiers: true,
        hasJewelryKarat: false,
        hasAutoOEM: false,
        hasPrescriptionRx: false,
        hasPerishable: true,
        hasWholesaleTiers: false
      },
      defaultCategories: ['Specialty Coffee & Espresso', 'Artisan Bread & Buns', 'Cream Cakes & Pastries', 'Traditional Sweets (Mithai)', 'Savory Patties & Rolls', 'Cookies & Biscuits', 'Custom Event Cakes'],
      sampleProducts: [
        { name: 'Spanish Latte (Iced 16oz)', barcode: 'CAFE_001', price: 680, cost: 220, stock: 999, category: 'Specialty Coffee & Espresso', unit: 'Cup', modifiers: 'Oat Milk, Vanilla Shot' },
        { name: 'Belgian Dark Chocolate Cake (2 Lbs)', barcode: 'BAKE_002', price: 2400, cost: 980, stock: 15, category: 'Cream Cakes & Pastries', unit: 'Cake' },
        { name: 'Chicken Puff Pastry Roll', barcode: 'BAKE_003', price: 160, cost: 75, stock: 60, category: 'Savory Patties & Rolls', unit: 'Pcs' }
      ]
    },

    'pharmacy-medical': {
      id: 'pharmacy-medical',
      name: 'Pharmacy, Medical Store & Drug Dispensary',
      icon: '',
      category: 'Healthcare',
      badge: 'Batch & Rx',
      subtitle: 'Medicines and healthcare with batch #, expiry tracking, formula search, and Rx alerts.',
      description: 'Compliant dispensary with drug interaction warnings, prescription requirement flags, active pharmaceutical generic ingredients, and shelf-bin locations.',
      customerLabel: 'Patient / Customer',
      itemLabel: 'Medicine',
      features: {
        hasBarcode: true,
        hasCostPrice: true,
        hasMinStock: true,
        hasVariants: false,
        hasBatchExpiry: true,
        hasSerialIMEI: false,
        hasWeightPricing: false,
        hasModifiers: false,
        hasJewelryKarat: false,
        hasAutoOEM: false,
        hasPrescriptionRx: true,
        hasPerishable: false,
        hasWholesaleTiers: false
      },
      defaultCategories: ['Antibiotics & Anti-Infectives', 'Pain Relief & Fever', 'Cardiovascular & Blood Pressure', 'Diabetes & Insulin', 'Gastrointestinal & Antacids', 'Vitamins & Multivitamins', 'Baby Care & Diapers', 'Surgical & Bandages'],
      sampleProducts: [
        { name: 'Panadol Extra 500mg (Box of 200)', barcode: '896400041001', price: 740, cost: 650, stock: 45, category: 'Pain Relief & Fever', unit: 'Box', batch: 'BN-8821', expiry: '2027-11-30', generic: 'Paracetamol + Caffeine' },
        { name: 'Augmentin 625mg Tablets (14s)', barcode: '896400041002', price: 420, cost: 360, stock: 60, category: 'Antibiotics & Anti-Infectives', unit: 'Pack', batch: 'AG-904', expiry: '2026-09-15', generic: 'Amoxicillin + Clavulanic Acid' },
        { name: 'Glucophage 500mg (50s)', barcode: '896400041003', price: 310, cost: 260, stock: 75, category: 'Diabetes & Insulin', unit: 'Pack', batch: 'GL-1102', expiry: '2028-03-20', generic: 'Metformin HCl' }
      ]
    },

    'electronics-highvalue': {
      id: 'electronics-highvalue',
      name: 'Mobile Phones, Computers & Appliances',
      icon: '',
      category: 'Electronics',
      badge: 'IMEI / Serial',
      subtitle: 'Serial number (IMEI/SN) tracking, multi-year warranty records, and device specs.',
      description: 'Captures individual serial numbers / IMEI per unit at checkout, warranty expiration dates, PTA tax status, and technical service repair intake.',
      customerLabel: 'Customer',
      itemLabel: 'Device / Accessory',
      features: {
        hasBarcode: true,
        hasCostPrice: true,
        hasMinStock: true,
        hasVariants: true,
        hasBatchExpiry: false,
        hasSerialIMEI: true,
        hasWeightPricing: false,
        hasModifiers: false,
        hasJewelryKarat: false,
        hasAutoOEM: false,
        hasPrescriptionRx: false,
        hasPerishable: false,
        hasWholesaleTiers: false,
        hasCustomerBuyback: true,
        hasBargaining: true
      },
      defaultCategories: ['Smartphones & Mobile Devices', 'Laptops & MacBooks', 'Computer Components & RAM', 'Audio, Earbuds & Headphones', 'Power Banks & Fast Chargers', 'Smart Watches & Bands', 'Home Appliances & TVs', 'Cables & Adapters'],
      sampleProducts: [
        { name: 'Samsung Galaxy A55 5G (8GB/256GB)', barcode: '896400051001', price: 124999, cost: 114000, stock: 12, category: 'Smartphones & Mobile Devices', unit: 'Unit', hasSerial: true, warrantyMonths: 12 },
        { name: 'Anker 65W GaN Fast Wall Charger', barcode: '896400051002', price: 6800, cost: 4900, stock: 35, category: 'Power Banks & Fast Chargers', unit: 'Pcs', warrantyMonths: 18 },
        { name: 'Logitech MX Master 3S Wireless Mouse', barcode: '896400051003', price: 23500, cost: 18500, stock: 8, category: 'Computer Components & RAM', unit: 'Unit', warrantyMonths: 24 }
      ]
    },

    'automotive-car': {
      id: 'automotive-car',
      name: 'Auto Spare Parts, Tyres & Lubricants',
      icon: '',
      category: 'Automotive',
      badge: 'OEM & Fitment',
      subtitle: 'OEM part cross-referencing, vehicle make/model/year compatibility search.',
      description: 'Allows searching by OEM code, chassis number, vehicle engine fitment (e.g. Corolla 2018-2023), core deposit return tracking, and tyre dimensions.',
      customerLabel: 'Customer / Fleet',
      itemLabel: 'Auto Part',
      features: {
        hasBarcode: true,
        hasCostPrice: true,
        hasMinStock: true,
        hasVariants: false,
        hasBatchExpiry: false,
        hasSerialIMEI: false,
        hasWeightPricing: false,
        hasModifiers: false,
        hasJewelryKarat: false,
        hasAutoOEM: true,
        hasPrescriptionRx: false,
        hasPerishable: false,
        hasWholesaleTiers: true
      },
      defaultCategories: ['Engine Oil & Synthetic Lubricants', 'Brake Pads, Rotors & Shoes', 'Oil, Air & Cabin Filters', 'Suspension & Shock Absorbers', 'Batteries & Alternators', 'Spark Plugs & Ignition', 'Headlights & Body Parts', 'Tyres & Alloy Wheels'],
      sampleProducts: [
        { name: 'Toyota Genuine 5W-30 Full Synthetic Oil 4L', barcode: 'AUTO_OIL_01', price: 9200, cost: 7800, stock: 40, category: 'Engine Oil & Synthetic Lubricants', unit: 'Can', oem: '08880-83389' },
        { name: 'Akebono Ceramic Front Brake Pads (Corolla)', barcode: 'AUTO_BRK_02', price: 5800, cost: 4200, stock: 18, category: 'Brake Pads, Rotors & Shoes', unit: 'Set', oem: 'AN-745WK', vehicleFitment: 'Toyota Corolla 2014-2022' },
        { name: 'Denso Iridium Tough Spark Plug (4s)', barcode: 'AUTO_SPK_03', price: 6400, cost: 4900, stock: 25, category: 'Spark Plugs & Ignition', unit: 'Pack', oem: 'VFXE24' }
      ]
    },

    'mechanic-workshop': {
      id: 'mechanic-workshop',
      name: 'Auto Workshop, Bike Repair & Service Center',
      icon: '',
      category: 'Automotive',
      badge: 'Job Cards & Labor',
      subtitle: 'Job cards, vehicle service history, labor charges, and technician commission.',
      description: 'Generates vehicle intake job cards, odometer logging, labor + spare part itemization, mechanic technician assignments, and service reminder SMS.',
      customerLabel: 'Vehicle Owner',
      itemLabel: 'Service / Part',
      features: {
        hasBarcode: true,
        hasCostPrice: true,
        hasMinStock: true,
        hasVariants: false,
        hasBatchExpiry: false,
        hasSerialIMEI: false,
        hasWeightPricing: false,
        hasModifiers: true,
        hasJewelryKarat: false,
        hasAutoOEM: true,
        hasPrescriptionRx: false,
        hasPerishable: false,
        hasWholesaleTiers: false
      },
      defaultCategories: ['Periodic Maintenance Packages', 'Labor Charges & Mechanical', 'AC Service & Gas Top-up', 'Wheel Alignment & Balancing', 'Tuning & Throttle Cleaning', 'Consumable Fluids & Grease', 'Brake Overhaul Service'],
      sampleProducts: [
        { name: 'Complete 10,000km Major Service Package', barcode: 'SRV_10K', price: 4500, cost: 1200, stock: 999, category: 'Periodic Maintenance Packages', unit: 'Job' },
        { name: 'Complete AC Servicing with R134a Gas', barcode: 'SRV_AC_01', price: 6500, cost: 2800, stock: 999, category: 'AC Service & Gas Top-up', unit: 'Job' },
        { name: 'Laser 4-Wheel Alignment & Computer Balancing', barcode: 'SRV_WHL_02', price: 2500, cost: 400, stock: 999, category: 'Wheel Alignment & Balancing', unit: 'Job' }
      ]
    },

    'salon-beauty': {
      id: 'salon-beauty',
      name: 'Hair Salon, Spa & Aesthetic Clinic',
      icon: '',
      category: 'Beauty',
      badge: 'Stylist & Tips',
      subtitle: 'Appointment calendar, service bundles, stylist commissions, and beauty retail.',
      description: 'Manages stylist appointment slots, multi-service bridal packages, staff tip splitting, client beauty history, and hair care retail upsells.',
      customerLabel: 'Client',
      itemLabel: 'Service / Retail',
      features: {
        hasBarcode: true,
        hasCostPrice: true,
        hasMinStock: true,
        hasVariants: false,
        hasBatchExpiry: true,
        hasSerialIMEI: false,
        hasWeightPricing: false,
        hasModifiers: true,
        hasJewelryKarat: false,
        hasAutoOEM: false,
        hasPrescriptionRx: false,
        hasPerishable: false,
        hasWholesaleTiers: false
      },
      defaultCategories: ['Hair Styling & Highlights', 'Hair Treatments & Keratin', 'Hydra Facial & Skincare', 'Bridal & Party Makeups', 'Manicure, Pedicure & Nails', 'Body Spa & Massage', 'Organic Haircare Retail'],
      sampleProducts: [
        { name: 'Brazilian Keratin Hair Treatment', barcode: 'SALON_01', price: 12000, cost: 3500, stock: 999, category: 'Hair Treatments & Keratin', unit: 'Session' },
        { name: '7-Step Hydra Glow Deep Facial', barcode: 'SALON_02', price: 6500, cost: 1800, stock: 999, category: 'Hydra Facial & Skincare', unit: 'Session' },
        { name: 'Moroccanoil Treatment Serum 100ml', barcode: '896400061001', price: 8900, cost: 6500, stock: 15, category: 'Organic Haircare Retail', unit: 'Bottle' }
      ]
    },

    'jewellery': {
      id: 'jewellery',
      name: 'Gold, Silver, Gemstones & Jewellery Studio',
      icon: '',
      category: 'Luxury',
      badge: 'Karat & Weight',
      subtitle: 'Precious metal weight (grams/tolas), karat purity pricing, and making charges.',
      description: 'Dynamic gold market rate integration per karat (24K/22K/21K/18K), net metal weight minus stone weight calculations, making fees, and buyback trade-ins.',
      customerLabel: 'Client / Investor',
      itemLabel: 'Jewellery Piece',
      features: {
        hasBarcode: true,
        hasCostPrice: true,
        hasMinStock: true,
        hasVariants: false,
        hasBatchExpiry: false,
        hasSerialIMEI: true,
        hasWeightPricing: true,
        hasModifiers: false,
        hasJewelryKarat: true,
        hasAutoOEM: false,
        hasPrescriptionRx: false,
        hasPerishable: false,
        hasWholesaleTiers: false,
        hasCustomerBuyback: true,
        hasBargaining: true
      },
      defaultCategories: ['22K Gold Bridal Sets', '21K Gold Bangles & Kangan', '18K Diamond Rings', 'Gold Chains & Necklaces', '925 Sterling Silver Jewellery', 'Loose Precious Gemstones', 'Pure 24K Gold Bars / Coins'],
      sampleProducts: [
        { name: '22K Gold Filigree Bridal Necklace (35.4g)', barcode: 'JEWEL_001', price: 820000, cost: 760000, stock: 2, category: '22K Gold Bridal Sets', unit: 'Piece', karat: '22K', netWeightGrams: 35.4, makingCharge: 25000 },
        { name: '18K White Gold Solitaire Diamond Ring 0.5ct', barcode: 'JEWEL_002', price: 245000, cost: 180000, stock: 3, category: '18K Diamond Rings', unit: 'Piece', karat: '18K', certificateId: 'GIA-884920' },
        { name: '24K Minted Gold Bar 10 Grams (999.9)', barcode: 'JEWEL_003', price: 255000, cost: 248000, stock: 10, category: 'Pure 24K Gold Bars / Coins', unit: 'Bar', karat: '24K', netWeightGrams: 10.0 }
      ]
    },

    'books-stationery': {
      id: 'books-stationery',
      name: 'Bookstore, Stationery & Copy Shop',
      icon: '',
      category: 'Retail',
      badge: 'ISBN Catalog',
      subtitle: 'ISBN scanning, publisher indexing, school booklists, and bulk paper reams.',
      description: 'Quick ISBN search, academic grade syllabus packs, photocopy/printing counters, art supplies, and corporate office stationery supply invoicing.',
      customerLabel: 'Customer / Student',
      itemLabel: 'Book / Supply',
      features: {
        hasBarcode: true,
        hasCostPrice: true,
        hasMinStock: true,
        hasVariants: false,
        hasBatchExpiry: false,
        hasSerialIMEI: false,
        hasWeightPricing: false,
        hasModifiers: false,
        hasJewelryKarat: false,
        hasAutoOEM: false,
        hasPrescriptionRx: false,
        hasPerishable: false,
        hasWholesaleTiers: true
      },
      defaultCategories: ['School & College Textbooks', 'Fiction & Literature', 'Islamic & Religious Books', 'Office Paper & Registers', 'Pens, Markers & Art Supplies', 'Calculators & Geometry', 'Printing & Binding Services'],
      sampleProducts: [
        { name: 'A4 Double A Copier Paper 80GSM (Ream 500s)', barcode: '896400071001', price: 1650, cost: 1420, stock: 150, category: 'Office Paper & Registers', unit: 'Ream' },
        { name: 'Atomic Habits by James Clear (Paperback)', barcode: '9781847941831', price: 1200, cost: 850, stock: 25, category: 'Fiction & Literature', unit: 'Book', isbn: '9781847941831' },
        { name: 'Casio FX-991EX Scientific Calculator', barcode: '4971850092315', price: 5400, cost: 4200, stock: 18, category: 'Calculators & Geometry', unit: 'Pcs' }
      ]
    },

    'hardware-tools': {
      id: 'hardware-tools',
      name: 'Hardware, Building Materials & Sanitary',
      icon: '',
      category: 'Trade',
      badge: 'Contractor Khata',
      subtitle: 'Cut-to-length pipes/wires, contractor credit ledgers, and bulk fastener box counts.',
      description: 'Units measured by meter, foot, kg, or sack. Integrated with contractor credit accounts, split-job deliveries, and trade discounts.',
      customerLabel: 'Contractor / Builder',
      itemLabel: 'Hardware Item',
      features: {
        hasBarcode: true,
        hasCostPrice: true,
        hasMinStock: true,
        hasVariants: false,
        hasBatchExpiry: false,
        hasSerialIMEI: false,
        hasWeightPricing: true,
        hasModifiers: false,
        hasJewelryKarat: false,
        hasAutoOEM: false,
        hasPrescriptionRx: false,
        hasPerishable: false,
        hasWholesaleTiers: true
      },
      defaultCategories: ['Power Tools & Machinery', 'Electrical Wires & Switches', 'PVC Pipes & Sanitary Fittings', 'Paints & Waterproofing', 'Fasteners, Screws & Nails', 'Hand Tools & Safety Gear', 'Cement & Tile Adhesives'],
      sampleProducts: [
        { name: 'Bosch Professional Impact Drill GSB 550', barcode: 'HW_TOOL_01', price: 11500, cost: 9200, stock: 12, category: 'Power Tools & Machinery', unit: 'Unit' },
        { name: 'Pakistan Cables 7/0.029 Single Core 90m Coil', barcode: 'HW_ELEC_02', price: 16800, cost: 14500, stock: 30, category: 'Electrical Wires & Switches', unit: 'Coil' },
        { name: 'Berger Robbialac Plastic Emulsion 16L Drum', barcode: 'HW_PNT_03', price: 14200, cost: 12000, stock: 20, category: 'Paints & Waterproofing', unit: 'Drum' }
      ]
    },

    'furniture-home': {
      id: 'furniture-home',
      name: 'Furniture, Mattresses & Home Decor',
      icon: '',
      category: 'Home',
      badge: 'Custom & Delivery',
      subtitle: 'Large-item dispatch scheduling, upholstery customization, and multi-stage deposits.',
      description: 'Tracks booking advances, delivery status milestones, custom fabric selections, assembly instructions, and room sets.',
      customerLabel: 'Customer',
      itemLabel: 'Furniture Piece',
      features: {
        hasBarcode: true,
        hasCostPrice: true,
        hasMinStock: true,
        hasVariants: true,
        hasBatchExpiry: false,
        hasSerialIMEI: false,
        hasWeightPricing: false,
        hasModifiers: true,
        hasJewelryKarat: false,
        hasAutoOEM: false,
        hasPrescriptionRx: false,
        hasPerishable: false,
        hasWholesaleTiers: false
      },
      defaultCategories: ['Living Room Sofas & Couches', 'Bed Sets & Wardrobes', 'Dining Tables & Chairs', 'Orthopedic Mattresses', 'Office Desks & Ergonomic Chairs', 'Lighting, Lamps & Chandeliers', 'Rugs, Carpets & Curtains'],
      sampleProducts: [
        { name: '6-Seater L-Shape Chesterfield Velvet Sofa', barcode: 'FURN_001', price: 88000, cost: 52000, stock: 4, category: 'Living Room Sofas & Couches', unit: 'Set', variants: 'Charcoal,Emerald Green,Royal Blue' },
        { name: 'King Size Solid Teakwood Bed Set + 2 Side Tables', barcode: 'FURN_002', price: 145000, cost: 95000, stock: 2, category: 'Bed Sets & Wardrobes', unit: 'Set' },
        { name: 'Diamond Pocket Spring King Mattress 8-Inch', barcode: 'FURN_003', price: 42000, cost: 28000, stock: 8, category: 'Orthopedic Mattresses', unit: 'Piece' }
      ]
    },

    'butchery-meat': {
      id: 'butchery-meat',
      name: 'Meat Shop, Poultry & Seafood Market',
      icon: '',
      category: 'Food',
      badge: 'Scale & Cuts',
      subtitle: 'Live weight scale pricing, custom butcher cuts (boneless, mince, chops), and cold storage decay.',
      description: 'Precision fractional gram weighing, cut type modifiers (curry cut, hand-mince, biryani cut), cold-storage batch logs, and rapid barcode label printing.',
      customerLabel: 'Customer',
      itemLabel: 'Meat Cut',
      features: {
        hasBarcode: true,
        hasCostPrice: true,
        hasMinStock: true,
        hasVariants: false,
        hasBatchExpiry: true,
        hasSerialIMEI: false,
        hasWeightPricing: true,
        hasModifiers: true,
        hasJewelryKarat: false,
        hasAutoOEM: false,
        hasPrescriptionRx: false,
        hasPerishable: true,
        hasWholesaleTiers: true
      },
      defaultCategories: ['Fresh Broiler Chicken', 'Desi Chicken & Quail', 'Mutton & Goat Meat', 'Veal & Beef (Boneless/Bone-in)', 'Fresh River & Sea Fish', 'Marinated Ready-to-Cook Meats', 'Bone Broth & Soup Bones'],
      sampleProducts: [
        { name: 'Fresh Chicken Breast Boneless (1kg)', barcode: 'MEAT_CHK_01', price: 920, cost: 760, stock: 80, category: 'Fresh Broiler Chicken', unit: 'kg', isWeightItem: true },
        { name: 'Fresh Mutton Mix Curry Cut (1kg)', barcode: 'MEAT_MUT_02', price: 2300, cost: 1950, stock: 45, category: 'Mutton & Goat Meat', unit: 'kg', isWeightItem: true },
        { name: 'Veal Beef Undercut Steak Fillet (1kg)', barcode: 'MEAT_BEEF_03', price: 1600, cost: 1280, stock: 30, category: 'Veal & Beef (Boneless/Bone-in)', unit: 'kg', isWeightItem: true }
      ]
    },

    'pet-vet': {
      id: 'pet-vet',
      name: 'Pet Shop, Animal Feed & Vet Care',
      icon: '',
      category: 'Pet',
      badge: 'Vet Diet & Breed',
      subtitle: 'Pet supplies, veterinary prescription diets, grooming charges, and vaccination schedules.',
      description: 'Species & breed record management, weighed dry food dispensing, flea/tick medication alerts, and pet clinic grooming appointments.',
      customerLabel: 'Pet Parent',
      itemLabel: 'Pet Supply / Service',
      features: {
        hasBarcode: true,
        hasCostPrice: true,
        hasMinStock: true,
        hasVariants: false,
        hasBatchExpiry: true,
        hasSerialIMEI: false,
        hasWeightPricing: true,
        hasModifiers: false,
        hasJewelryKarat: false,
        hasAutoOEM: false,
        hasPrescriptionRx: true,
        hasPerishable: false,
        hasWholesaleTiers: false
      },
      defaultCategories: ['Premium Cat Food & Pouches', 'Dog Kibble & Nutrition', 'Cat Litter & Deodorizers', 'Pet Shampoos & Grooming Gear', 'Pet Medicines & Vaccines', 'Collars, Leashes & Toys', 'Vet Consultation & Grooming'],
      sampleProducts: [
        { name: 'Royal Canin Mother & Babycat 2kg', barcode: '896400081001', price: 6200, cost: 4800, stock: 24, category: 'Premium Cat Food & Pouches', unit: 'Bag' },
        { name: 'Bentonite Clumping Cat Litter 10L (Lavender)', barcode: '896400081002', price: 1950, cost: 1350, stock: 40, category: 'Cat Litter & Deodorizers', unit: 'Bag' },
        { name: 'Complete Full Pet Grooming & Spa Wash', barcode: 'PET_SRV_01', price: 3500, cost: 800, stock: 999, category: 'Vet Consultation & Grooming', unit: 'Job' }
      ]
    },

    'optics-eyewear': {
      id: 'optics-eyewear',
      name: 'Optometry, Eyewear & Lens Studio',
      icon: '',
      category: 'Healthcare',
      badge: 'Rx Lens Powers',
      subtitle: 'Prescription lens powers (Sph/Cyl/Axis), designer frame tags, and contact lenses.',
      description: 'Logs customer refraction test powers (OD/OS), pupil distance (PD), anti-glare blue-cut coating options, and contact lens expiry batches.',
      customerLabel: 'Patient / Client',
      itemLabel: 'Frame / Lens',
      features: {
        hasBarcode: true,
        hasCostPrice: true,
        hasMinStock: true,
        hasVariants: true,
        hasBatchExpiry: true,
        hasSerialIMEI: false,
        hasWeightPricing: false,
        hasModifiers: true,
        hasJewelryKarat: false,
        hasAutoOEM: false,
        hasPrescriptionRx: true,
        hasPerishable: false,
        hasWholesaleTiers: false
      },
      defaultCategories: ['Designer Optical Frames', 'Polarized Sunglasses', 'Blue-Cut Digital Computer Lenses', 'High Index Progressive Lenses', 'Monthly Disposable Contact Lenses', 'Lens Cleaning Kits & Cases', 'Refraction & Eye Testing'],
      sampleProducts: [
        { name: 'Ray-Ban Clubmaster Classic Frame (Tortoise)', barcode: 'OPT_FRM_01', price: 28500, cost: 19000, stock: 6, category: 'Designer Optical Frames', unit: 'Piece' },
        { name: '1.61 High Index Blue-Block Lenses (Pair)', barcode: 'OPT_LNS_02', price: 4500, cost: 1800, stock: 999, category: 'Blue-Cut Digital Computer Lenses', unit: 'Pair' },
        { name: 'Acuvue Oasys Contact Lenses (6 Pack)', barcode: 'OPT_CNT_03', price: 6800, cost: 5100, stock: 18, category: 'Monthly Disposable Contact Lenses', unit: 'Box' }
      ]
    },

    'wholesale-b2b': {
      id: 'wholesale-b2b',
      name: 'Wholesale, Bulk Trading & B2B Distribution',
      icon: '',
      category: 'B2B',
      badge: 'Tiered Bulk Rates',
      subtitle: 'Tiered quantity pricing (Cartons/Pallets), credit ledger limits, and tax invoices.',
      description: 'Supports dynamic tiered pricing based on order volume (e.g. 1-10 cases vs 50+ cases), credit lines, purchase orders, and sales rep commission.',
      customerLabel: 'Trader / B2B Buyer',
      itemLabel: 'Wholesale SKU',
      features: {
        hasBarcode: true,
        hasCostPrice: true,
        hasMinStock: true,
        hasVariants: false,
        hasBatchExpiry: true,
        hasSerialIMEI: false,
        hasWeightPricing: true,
        hasModifiers: false,
        hasJewelryKarat: false,
        hasAutoOEM: false,
        hasPrescriptionRx: false,
        hasPerishable: false,
        hasWholesaleTiers: true
      },
      defaultCategories: ['Bulk Fast Moving Consumer Goods', 'Beverages (Carton Packs)', 'Edible Oils & Ghee Tins', 'Sugar, Flour & Rice Sacks', 'Toiletries & Soaps Wholesale', 'Confectionery Bulk Boxes'],
      sampleProducts: [
        { name: 'Nestle Everyday Powder Milk (Master Carton 24s)', barcode: 'WS_BULK_01', price: 24800, cost: 22500, stock: 85, category: 'Bulk Fast Moving Consumer Goods', unit: 'Carton', wholesaleTiers: '1-4: 24800, 5-19: 24200, 20+: 23600' },
        { name: 'Coca Cola 1.5L PET (Pack of 6 Bottles)', barcode: 'WS_BEV_02', price: 960, cost: 840, stock: 320, category: 'Beverages (Carton Packs)', unit: 'Case', wholesaleTiers: '1-9: 960, 10-49: 930, 50+: 900' },
        { name: 'Dalda Cooking Oil 5L Tin (Carton of 4)', barcode: 'WS_OIL_03', price: 11200, cost: 10400, stock: 110, category: 'Edible Oils & Ghee Tins', unit: 'Carton' }
      ]
    },

    'services-consulting': {
      id: 'services-consulting',
      name: 'Services, Consulting, Repairs & Agency',
      icon: '',
      category: 'Services',
      badge: 'Hourly & Retainers',
      subtitle: 'Hourly billing, project retainer invoices, and service appointment tracking.',
      description: 'Itemizes billable consultation hours, fixed retainer milestone invoices, deliverables, client intake briefs, and multi-staff billing allocation.',
      customerLabel: 'Client',
      itemLabel: 'Service Package',
      features: {
        hasBarcode: false,
        hasCostPrice: true,
        hasMinStock: false,
        hasVariants: false,
        hasBatchExpiry: false,
        hasSerialIMEI: false,
        hasWeightPricing: false,
        hasModifiers: true,
        hasJewelryKarat: false,
        hasAutoOEM: false,
        hasPrescriptionRx: false,
        hasPerishable: false,
        hasWholesaleTiers: false
      },
      defaultCategories: ['Consulting & Advisory Retainers', 'Technical Repair & Labor', 'Design & Digital Media Packages', 'Maintenance & AMC Contracts', 'Legal & Financial Advisory', 'Training & Workshop Passes'],
      sampleProducts: [
        { name: 'Monthly Digital Retainer (Growth Tier)', barcode: 'SRV_MKT_01', price: 85000, cost: 32000, stock: 999, category: 'Consulting & Advisory Retainers', unit: 'Month' },
        { name: 'IT Infrastructure On-Site Audit & Diagnostic', barcode: 'SRV_IT_02', price: 15000, cost: 4000, stock: 999, category: 'Technical Repair & Labor', unit: 'Audit' },
        { name: 'Annual Software Maintenance Contract (AMC)', barcode: 'SRV_AMC_03', price: 60000, cost: 15000, stock: 999, category: 'Maintenance & AMC Contracts', unit: 'Year' }
      ]
    },

    'custom-hybrid': {
      id: 'custom-hybrid',
      name: 'Custom Mixed Enterprise (All Features)',
      icon: '',
      category: 'Enterprise',
      badge: 'Full Suite',
      subtitle: 'All fields enabled: barcodes, serials, batches, variants, weight scale & modifiers.',
      description: 'The ultimate hybrid engine for multi-faceted businesses: combines physical goods with IMEI tracking, fresh weight scale produce, kitchen orders, and wholesale pricing.',
      customerLabel: 'Customer / Client',
      itemLabel: 'Item / SKU',
      features: {
        hasBarcode: true,
        hasCostPrice: true,
        hasMinStock: true,
        hasVariants: true,
        hasBatchExpiry: true,
        hasSerialIMEI: true,
        hasWeightPricing: true,
        hasModifiers: true,
        hasJewelryKarat: true,
        hasAutoOEM: true,
        hasPrescriptionRx: true,
        hasPerishable: true,
        hasWholesaleTiers: true
      },
      defaultCategories: ['Retail Merchandise', 'Perishables & Fresh', 'Electronics & Hardware', 'Services & Labor', 'Wholesale Bulk Packages'],
      sampleProducts: [
        { name: 'Universal Hybrid Item (Demo SKU)', barcode: '896400099001', price: 1500, cost: 950, stock: 50, category: 'Retail Merchandise', unit: 'Pcs' }
      ]
    }
  };

  // Dynamic Form Field Applicator
  function applyMode(modeKey) {
    const config = STORE_MODES[modeKey] || STORE_MODES['simple-retail'];
    console.log(`[StoreModes] Applying store mode: ${config.name} (${config.id})`);

    // 1. Update localStorage & state preferences
    try {
      localStorage.setItem('valenixia_shop_mode', config.id);
      if (window.state) {
        window.state.shopMode = config.id;
        if (window.state.preferences) {
          window.state.preferences.shop_mode = config.id;
          window.state.preferences.store_type = config.id;
        }
      }
    } catch (_) {}

    // 2. Adjust Product Add/Edit Modal Dynamic Sections
    const f = config.features;
    const toggleField = (id, show) => {
      const el = document.getElementById(id);
      if (el) {
        el.style.display = show ? 'block' : 'none';
      }
    };

    toggleField('field-group-batch-expiry', f.hasBatchExpiry || f.hasPrescriptionRx);
    toggleField('field-group-serial-imei', f.hasSerialIMEI);
    toggleField('field-group-variants', f.hasVariants);
    toggleField('field-group-weight-scale', f.hasWeightPricing);
    toggleField('field-group-restaurant-modifiers', f.hasModifiers);
    toggleField('field-group-jewelry-karat', f.hasJewelryKarat);
    toggleField('field-group-auto-oem', f.hasAutoOEM);
    toggleField('field-group-prescription-rx', f.hasPrescriptionRx);
    toggleField('field-group-wholesale-tiers', f.hasWholesaleTiers);

    // 3. Update customer / item labels across UI
    const customerLabelEls = document.querySelectorAll('.dynamic-customer-label');
    customerLabelEls.forEach(el => el.textContent = config.customerLabel);

    const itemLabelEls = document.querySelectorAll('.dynamic-item-label');
    itemLabelEls.forEach(el => el.textContent = config.itemLabel);

    // 4. Update store mode display badge in Settings
    const activeBadge = document.getElementById('settings-active-mode-badge');
    if (activeBadge) {
      activeBadge.textContent = config.name;
    }

    // 5. Hospitality KDS & Restaurant Features Isolation
    const isHospitality = (config.id === 'food-restaurant' || config.id === 'bakery-cafe');
    const kdsNav = document.getElementById('nav-kds');
    if (kdsNav) {
      kdsNav.style.setProperty('display', isHospitality ? 'flex' : 'none', 'important');
    }
    const kdsQuickBtn = document.getElementById('btn-quick-kds');
    if (kdsQuickBtn) {
      kdsQuickBtn.style.setProperty('display', isHospitality ? 'inline-flex' : 'none', 'important');
    }
    document.querySelectorAll('[data-screen="kds"], .kds-only-element').forEach(el => {
      el.style.setProperty('display', isHospitality ? 'flex' : 'none', 'important');
    });

    if (typeof window.updateKdsNavVisibility === 'function') {
      window.updateKdsNavVisibility();
    }

    // 6. Reset active order type if not available in target store mode
    const orderTypes = STORE_ORDER_TYPES[config.id] || STORE_ORDER_TYPES['default'];
    if (!orderTypes.some(t => t.id === window.__activeOrderType)) {
      window.__activeOrderType = (orderTypes.find(t => t.default) || orderTypes[0]).id;
      window.__activeOrderMeta = '';
    }

    // 7. Re-render dynamic Order Type Bar
    renderOrderTypeBar();

    // 8. Update Buy-In / Trade-In Navigation Visibility
    if (typeof window !== 'undefined' && typeof window.updateBuybackNavVisibility === 'function') {
      try { window.updateBuybackNavVisibility(); } catch (_) {}
    }

    // 9. Update Jewellery Bullion Ticker & Studio Controls
    if (typeof window !== 'undefined') {
      try {
        if (window.ValenixiaJewellery && typeof window.ValenixiaJewellery.renderGoldRateTicker === 'function') {
          window.ValenixiaJewellery.renderGoldRateTicker();
        }
        window.dispatchEvent(new CustomEvent('valenixia:store-mode-changed', { detail: config }));
      } catch (_) {}
    }

    return config;
  }

  const STORE_ORDER_TYPES = {
    'food-restaurant': [
      { id: 'DINE_IN', label: 'Dine-In', label_ur: 'ڈائن ان', iconSvg: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>', metaKey: 'table_number', metaLabel: 'Table #', metaLabelUr: 'میز نمبر', metaPlaceholder: 'e.g. Table 4', default: true },
      { id: 'TAKEAWAY', label: 'Takeaway', label_ur: 'ٹیک اوے', iconSvg: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>', metaKey: 'token_number', metaLabel: 'Token #', metaLabelUr: 'ٹوکن نمبر', metaPlaceholder: 'e.g. Token 12' },
      { id: 'DELIVERY', label: 'Delivery', label_ur: 'ہوم ڈلیوری', iconSvg: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>', metaKey: 'rider_info', metaLabel: 'Rider / Address', metaLabelUr: 'رائڈر / پتہ', metaPlaceholder: 'Rider name & address' },
      { id: 'FOODPANDA', label: 'Foodpanda', label_ur: 'فوڈ پانڈا', iconSvg: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>', metaKey: 'order_ref', metaLabel: 'Order Ref', metaLabelUr: 'آرڈر نمبر', metaPlaceholder: 'e.g. #FP-8891' },
      { id: 'RESERVATION', label: 'Reservation', label_ur: 'میز بکنگ', iconSvg: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>', metaKey: 'reservation_info', metaLabel: 'Reservation', metaLabelUr: 'بکنگ تفصیل', metaPlaceholder: 'e.g. 4 Guests @ 8pm' }
    ],
    'bakery-cafe': [
      { id: 'DINE_IN', label: 'Café Dine-In', label_ur: 'کیفے ڈائن ان', iconSvg: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/></svg>', metaKey: 'table_number', metaLabel: 'Table #', metaLabelUr: 'میز نمبر', metaPlaceholder: 'e.g. T-2', default: true },
      { id: 'TAKEAWAY', label: 'Takeaway', label_ur: 'پارسل', iconSvg: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/></svg>', metaKey: 'token_number', metaLabel: 'Token #', metaLabelUr: 'ٹوکن نمبر', metaPlaceholder: 'e.g. Token 5' },
      { id: 'DELIVERY', label: 'Delivery', label_ur: 'ڈلیوری', iconSvg: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 8"/></svg>', metaKey: 'rider_info', metaLabel: 'Address', metaLabelUr: 'پتہ', metaPlaceholder: 'Phone & delivery address' },
      { id: 'FOODPANDA', label: 'Foodpanda', label_ur: 'فوڈ پانڈا', iconSvg: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/></svg>', metaKey: 'order_ref', metaLabel: 'Order ID', metaLabelUr: 'آرڈر نمبر', metaPlaceholder: 'e.g. #FP-9901' },
      { id: 'ADVANCE_ORDER', label: 'Advance Cake', label_ur: 'ایڈوانس آرڈر', iconSvg: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/></svg>', metaKey: 'event_date', metaLabel: 'Delivery Date', metaLabelUr: 'تاریخ و وقت', metaPlaceholder: 'e.g. Tomorrow 5pm' }
    ],
    'mechanic-workshop': [
      { id: 'JOB_CARD', label: 'Job Card', label_ur: 'گاڑی سروس جاب کارڈ', iconSvg: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>', metaKey: 'vehicle_job', metaLabel: 'Vehicle / Job #', metaLabelUr: 'گاڑی نمبر / جاب کارڈ', metaPlaceholder: 'e.g. LEB-4522 (Oil + Tuning)', default: true },
      { id: 'WALKIN_SERVICE', label: 'Quick Walk-in', label_ur: 'فوری جاب', iconSvg: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>', metaKey: 'technician', metaLabel: 'Mechanic / Bay', metaLabelUr: 'مکینک / بے نمبر', metaPlaceholder: 'e.g. Ustad Tariq / Bay 2' },
      { id: 'APPOINTMENT', label: 'Appointment', label_ur: 'وقت بکنگ', iconSvg: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/></svg>', metaKey: 'booking_time', metaLabel: 'Slot Time', metaLabelUr: 'وقت بکنگ', metaPlaceholder: 'e.g. Today 4:30 PM' }
    ],
    'automotive-car': [
      { id: 'WALKIN', label: 'Counter Sale', label_ur: 'کاؤنٹر فروخت', iconSvg: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>', metaKey: '', metaLabel: '', metaLabelUr: '', metaPlaceholder: '', default: true },
      { id: 'DELIVERY', label: 'Fleet / Garage Delivery', label_ur: 'ورکشاپ ڈلیوری', iconSvg: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>', metaKey: 'garage_address', metaLabel: 'Garage / Fleet Name', metaLabelUr: 'ورکشاپ نام', metaPlaceholder: 'e.g. Speed Autos Workshop' },
      { id: 'PICKUP', label: 'Order Pickup', label_ur: 'اسٹور سے پک اپ', iconSvg: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>', metaKey: 'pickup_ref', metaLabel: 'Part Order Ref', metaLabelUr: 'آرڈر حوالہ', metaPlaceholder: 'e.g. PO-8821' },
      { id: 'WHOLESALE', label: 'Wholesale B2B', label_ur: 'تھوک کھاتہ', iconSvg: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>', metaKey: 'buyer_khata', metaLabel: 'Dealer Khata #', metaLabelUr: 'ڈیلر کھاتہ نمبر', metaPlaceholder: 'e.g. Master Motors Khata' }
    ],
    'pharmacy-medical': [
      { id: 'OTC_WALKIN', label: 'OTC Walk-in', label_ur: 'او ٹی سی کاؤنٹر', iconSvg: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M2 12h20"/></svg>', metaKey: '', metaLabel: '', metaLabelUr: '', metaPlaceholder: '', default: true },
      { id: 'PRESCRIPTION', label: 'Prescription (Rx)', label_ur: 'ڈاکٹر نسخہ (Rx)', iconSvg: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>', metaKey: 'doctor_patient', metaLabel: 'Doctor / Patient', metaLabelUr: 'ڈاکٹر / مریض', metaPlaceholder: 'e.g. Dr. Asif / Ahmed' },
      { id: 'DELIVERY', label: 'Urgent Delivery', label_ur: 'میڈیسن ڈلیوری', iconSvg: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 8"/></svg>', metaKey: 'patient_address', metaLabel: 'Patient Address', metaLabelUr: 'مریض پتہ', metaPlaceholder: 'Address & contact' }
    ],
    'repair-services': [
      { id: 'WALKIN_SERVICE', label: 'Walk-in Job', label_ur: 'فوری جاب', iconSvg: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>', metaKey: '', metaLabel: '', metaLabelUr: '', metaPlaceholder: '', default: true },
      { id: 'JOB_CARD', label: 'Job Card Drop-off', label_ur: 'مرمت جاب کارڈ', iconSvg: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>', metaKey: 'job_serial', metaLabel: 'Item / Serial', metaLabelUr: 'آئٹم / ماڈل', metaPlaceholder: 'e.g. iPhone 13 - Screen' },
      { id: 'APPOINTMENT', label: 'Appointment', label_ur: 'وقت بکنگ', iconSvg: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/></svg>', metaKey: 'booking_time', metaLabel: 'Slot Time', metaLabelUr: 'وقت', metaPlaceholder: 'e.g. Today 4:00 PM' }
    ],
    'clothing-fashion': [
      { id: 'WALKIN', label: 'Boutique Sale', label_ur: 'دکان پر خریداری', iconSvg: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>', metaKey: '', metaLabel: '', metaLabelUr: '', metaPlaceholder: '', default: true },
      { id: 'DELIVERY', label: 'Courier Delivery', label_ur: 'کورئیر ڈلیوری', iconSvg: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>', metaKey: 'courier_cn', metaLabel: 'Courier Tracking / CN', metaLabelUr: 'کورئیر ٹریکنگ نمبر', metaPlaceholder: 'e.g. TCS / Leopards CN' },
      { id: 'PICKUP', label: 'Boutique Pickup', label_ur: 'اسٹور پک اپ', iconSvg: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>', metaKey: 'client_name', metaLabel: 'Fitting / Hold Ref', metaLabelUr: 'گاہک حوالہ', metaPlaceholder: 'e.g. Mrs. Farooq Alteration' }
    ],
    'electronics-highvalue': [
      { id: 'WALKIN', label: 'Counter Sale', label_ur: 'کاؤنٹر فروخت', iconSvg: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>', metaKey: '', metaLabel: '', metaLabelUr: '', metaPlaceholder: '', default: true },
      { id: 'DELIVERY', label: 'Secure Dispatch', label_ur: 'محفوظ ڈلیوری', iconSvg: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>', metaKey: 'rider_info', metaLabel: 'Dispatch Address', metaLabelUr: 'ڈلیوری پتہ', metaPlaceholder: 'Customer address & phone' },
      { id: 'PICKUP', label: 'Store Pickup', label_ur: 'اسٹور پک اپ', iconSvg: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>', metaKey: 'booking_ref', metaLabel: 'Order Booking Ref', metaLabelUr: 'بکنگ نمبر', metaPlaceholder: 'e.g. Pre-order #EL-401' }
    ],
    'grocery-mart': [
      { id: 'WALKIN', label: 'Counter Walk-in', label_ur: 'دکان پر خریداری', iconSvg: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>', metaKey: '', metaLabel: '', metaLabelUr: '', metaPlaceholder: '', default: true },
      { id: 'DELIVERY', label: 'Home Delivery', label_ur: 'ہوم ڈلیوری', iconSvg: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>', metaKey: 'rider_info', metaLabel: 'Delivery Address', metaLabelUr: 'گاہک کا پتہ', metaPlaceholder: 'House #, Street, Area' },
      { id: 'PICKUP', label: 'Express Pickup', label_ur: 'ایکسپریس پک اپ', iconSvg: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>', metaKey: 'pickup_time', metaLabel: 'Ready Time', metaLabelUr: 'پیکنگ وقت', metaPlaceholder: 'e.g. Ready in 30 mins' },
      { id: 'WHOLESALE', label: 'Bulk / Khata', label_ur: 'تھوک کارٹن کھاتہ', iconSvg: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>', metaKey: 'buyer_khata', metaLabel: 'Customer Khata', metaLabelUr: 'گاہک کھاتہ نمبر', metaPlaceholder: 'e.g. VIP Khata #102' }
    ],
    'simple-retail': [
      { id: 'WALKIN', label: 'Counter Walk-in', label_ur: 'دکان پر خریداری', iconSvg: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>', metaKey: '', metaLabel: '', metaLabelUr: '', metaPlaceholder: '', default: true },
      { id: 'DELIVERY', label: 'Home Delivery', label_ur: 'ہوم ڈلیوری', iconSvg: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>', metaKey: 'rider_info', metaLabel: 'Delivery Address', metaLabelUr: 'گاہک کا پتہ', metaPlaceholder: 'Customer address & phone' },
      { id: 'PICKUP', label: 'Store Pickup', label_ur: 'اسٹور سے پک اپ', iconSvg: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>', metaKey: 'pickup_time', metaLabel: 'Pickup Time', metaLabelUr: 'پک اپ وقت', metaPlaceholder: 'e.g. Ready by 6pm' },
      { id: 'WHOLESALE', label: 'Wholesale B2B', label_ur: 'تھوک مال / کھاتہ', iconSvg: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>', metaKey: 'buyer_ntn', metaLabel: 'Buyer / Khata', metaLabelUr: 'خریدار کھاتہ', metaPlaceholder: 'e.g. Khan Traders' }
    ],
    'default': [
      { id: 'WALKIN', label: 'Counter Walk-in', label_ur: 'دکان پر خریداری', iconSvg: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>', metaKey: '', metaLabel: '', metaLabelUr: '', metaPlaceholder: '', default: true },
      { id: 'DELIVERY', label: 'Home Delivery', label_ur: 'ہوم ڈلیوری', iconSvg: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>', metaKey: 'rider_info', metaLabel: 'Delivery Address', metaLabelUr: 'گاہک کا پتہ', metaPlaceholder: 'Customer address & phone' },
      { id: 'PICKUP', label: 'Store Pickup', label_ur: 'اسٹور سے پک اپ', iconSvg: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>', metaKey: 'pickup_time', metaLabel: 'Pickup Time', metaLabelUr: 'پک اپ وقت', metaPlaceholder: 'e.g. Ready by 6pm' },
      { id: 'WHOLESALE', label: 'Wholesale B2B', label_ur: 'تھوک مال / کھاتہ', iconSvg: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>', metaKey: 'buyer_ntn', metaLabel: 'Buyer / Khata', metaLabelUr: 'خریدار کھاتہ', metaPlaceholder: 'e.g. Khan Traders' }
    ],
    'jewellery': [
      { id: 'WALKIN', label: 'Counter Sale', label_ur: 'کاؤنٹر فروخت', iconSvg: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>', metaKey: '', metaLabel: '', metaLabelUr: '', metaPlaceholder: '', default: true },
      { id: 'CUSTOM_ORDER', label: 'Custom Order', label_ur: 'کسٹم آرڈر', iconSvg: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>', metaKey: 'design_spec', metaLabel: 'Design / Spec', metaLabelUr: 'ڈیزائن تفصیل', metaPlaceholder: 'e.g. 22K Necklace with emerald, 35g' },
      { id: 'GOLD_BUYBACK', label: 'Gold Buyback', label_ur: 'پرانا سونا خریداری', iconSvg: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.6"/></svg>', metaKey: 'buyback_details', metaLabel: 'Item / Karat / Weight', metaLabelUr: 'پرانا سونا تفصیل', metaPlaceholder: 'e.g. Old 22K ring, 8.5g' },
      { id: 'ADVANCE_ORDER', label: 'Advance (Deposit)', label_ur: 'ایڈوانس بکنگ', iconSvg: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>', metaKey: 'delivery_date', metaLabel: 'Delivery Date', metaLabelUr: 'ڈلیوری تاریخ', metaPlaceholder: 'e.g. 15 Sep 2026 (50% advance paid)' },
      { id: 'REPAIR_SERVICE', label: 'Repair / Polish', label_ur: 'مرمت / پالش', iconSvg: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>', metaKey: 'repair_job', metaLabel: 'Repair Description', metaLabelUr: 'مرمت تفصیل', metaPlaceholder: 'e.g. Ring resize + polish' }
    ]
  };

  function renderOrderTypeBar() {
    const container = document.getElementById('checkout-order-type-pills');
    const metaRow = document.getElementById('checkout-order-type-meta-row');
    const metaLbl = document.getElementById('lbl-order-meta');
    const metaInput = document.getElementById('input-order-type-meta');
    if (!container) return;

    const currentMode = localStorage.getItem('valenixia_shop_mode') || (window.state && window.state.preferences && (window.state.preferences.shop_mode || window.state.preferences.store_type)) || 'simple-retail';
    const orderTypes = STORE_ORDER_TYPES[currentMode] || STORE_ORDER_TYPES['default'];
    const isUrdu = (localStorage.getItem('valenixia_language') === 'ur') || (document.documentElement.lang === 'ur');

    if (!orderTypes.some(t => t.id === window.__activeOrderType)) {
      window.__activeOrderType = (orderTypes.find(t => t.default) || orderTypes[0]).id;
      window.__activeOrderMeta = '';
    }

    let activeType = window.__activeOrderType;

    container.innerHTML = orderTypes.map(ot => `
      <button type="button" class="order-type-pill ${ot.id === activeType ? 'active' : ''}" data-order-type="${ot.id}">
        <span style="display:inline-flex;align-items:center;">${ot.iconSvg || ''}</span>
        <span>${isUrdu ? ot.label_ur : ot.label}</span>
      </button>
    `).join('');

    const currentOt = orderTypes.find(t => t.id === activeType) || orderTypes[0];
    if (currentOt && currentOt.metaLabel) {
      if (metaRow) metaRow.style.display = 'flex';
      if (metaLbl) metaLbl.textContent = isUrdu ? currentOt.metaLabelUr + ':' : currentOt.metaLabel + ':';
      if (metaInput) {
        metaInput.placeholder = currentOt.metaPlaceholder;
        metaInput.value = window.__activeOrderMeta || '';
      }
    } else {
      if (metaRow) metaRow.style.display = 'none';
      if (metaInput) metaInput.value = '';
      window.__activeOrderMeta = '';
    }

    container.querySelectorAll('.order-type-pill').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const otId = btn.getAttribute('data-order-type');
        window.__activeOrderType = otId;
        renderOrderTypeBar();
      });
    });

    if (metaInput && !metaInput.dataset.bound) {
      metaInput.dataset.bound = 'true';
      metaInput.addEventListener('input', (e) => {
        window.__activeOrderMeta = e.target.value;
      });
    }
  }

  function isBuybackSupported(mode) {
    const active = mode || (typeof localStorage !== 'undefined' && localStorage.getItem('valenixia_shop_mode')) || (typeof window !== 'undefined' && window.state && window.state.preferences && (window.state.preferences.shop_mode || window.state.preferences.store_type)) || 'simple-retail';
    const modeConfig = STORE_MODES[active];
    if (modeConfig && modeConfig.features && modeConfig.features.hasCustomerBuyback !== undefined) {
      return Boolean(modeConfig.features.hasCustomerBuyback);
    }
    const BUYBACK_MODES = new Set(['electronics-highvalue', 'mobile-repair', 'jewellery', 'jewellery-gold', 'pawn-gold', 'computer-it', 'automotive-car']);
    return BUYBACK_MODES.has(active);
  }
  globalScope.isBuybackSupported = isBuybackSupported;

  // Export to Global Scope
  globalScope.ValenixiaStoreModes = {
    MODES: STORE_MODES,
    ORDER_TYPES: STORE_ORDER_TYPES,
    getMode(key) {
      return STORE_MODES[key] || STORE_MODES['simple-retail'];
    },
    getAllModes() {
      return Object.values(STORE_MODES);
    },
    applyMode: applyMode,
    renderOrderTypeBar: renderOrderTypeBar,
    isBuybackSupported: isBuybackSupported
  };

  if (typeof document !== 'undefined') {
    const onReady = () => {
      setTimeout(() => {
        renderOrderTypeBar();
        if (typeof window !== 'undefined' && typeof window.updateBuybackNavVisibility === 'function') {
          try { window.updateBuybackNavVisibility(); } catch (_) {}
        }
      }, 50);
    };
    if (document.readyState === 'interactive' || document.readyState === 'complete') {
      onReady();
    } else {
      document.addEventListener('DOMContentLoaded', onReady);
    }
  }

})(typeof window !== 'undefined' ? window : global);
