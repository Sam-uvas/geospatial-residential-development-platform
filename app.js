/* ============================================================
   MRDIP — Municipal Residential Development Intelligence Platform
   app.js — Complete Application Logic (FULLY FIXED)
   Fixes: Map jumping, parcel search, colored parcels persistence, filters, report controls
============================================================ */

'use strict';

/* ─── STATE ──────────────────────────────────────────────────── */
const State = {
  allFeatures: [],
  filteredFeatures: [],
  selectedParcel: null,
  charts: {},
  map: null,
  geojsonLayer: null,
  selectedLayer: null,
  tableSort: { col: 'rdsi', dir: 'desc' },
  tablePage: 1,
  tablePageSize: 15,
  tableSearch: '',
  reportType: 'summary',
  labelsVisible: false,
  labelLayers: [],
  parcelSearchTimeout: null,
};

/* ─── COLOUR HELPERS ─────────────────────────────────────────── */
const rdsiColour = rdsi => {
  if (rdsi >= 80) return '#10b981';
  if (rdsi >= 60) return '#f59e0b';
  if (rdsi >= 40) return '#f97316';
  return '#ef4444';
};

const rdsiClass = rdsi => {
  if (rdsi >= 80) return 'rdsi-high';
  if (rdsi >= 60) return 'rdsi-medium';
  if (rdsi >= 40) return 'rdsi-mod';
  return 'rdsi-low';
};

const scoreColour = (score) => {
  if (score >= 80) return '#10b981';
  if (score >= 60) return '#f59e0b';
  if (score >= 40) return '#f97316';
  return '#ef4444';
};

/* ─── LOADING SCREEN ─────────────────────────────────────────── */
const Loading = {
  msgs: [
    'Initialising spatial analysis engine...',
    'Loading Johannesburg cadastral dataset...',
    'Rendering parcel geometries...',
    'Calibrating RDSI model...',
    'Building analytics pipeline...',
    'Preparing dashboard components...',
    'System ready.'
  ],
  _bar: null, _msg: null,
  init() {
    this._bar = document.getElementById('loading-bar');
    this._msg = document.getElementById('loading-msg');
  },
  set(pct, msgIdx) {
    if (this._bar) this._bar.style.width = pct + '%';
    if (this._msg && msgIdx !== undefined) this._msg.textContent = this.msgs[msgIdx] || '';
  },
  hide() {
    const el = document.getElementById('loading-screen');
    if (el) { 
      el.style.opacity = '0'; 
      el.style.transition = 'opacity 0.5s'; 
      setTimeout(() => el.remove(), 500); 
    }
  }
};

/* ─── CLOCK ──────────────────────────────────────────────────── */
const startClock = () => {
  const el = document.getElementById('header-clock');
  if (!el) return;
  const tick = () => {
    const d = new Date();
    el.textContent = d.toLocaleTimeString('en-ZA', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  };
  tick(); 
  setInterval(tick, 1000);
};

/* ─── LOAD DATA FROM YOUR GEOJSON ─────────────────────────────── */
const loadData = async () => {
  console.log('Loading Johannesburg RDSI GeoJSON...');
  
  const possibleFiles = ['residential_suitability.geojson', 'Johannesburg_RDSI.geojson'];
  let geojson = null;
  let loadedFile = null;
  
  for (const file of possibleFiles) {
    try {
      console.log(`Attempting to load: ${file}`);
      const response = await fetch(file);
      if (response.ok) {
        geojson = await response.json();
        loadedFile = file;
        console.log(`✅ Successfully loaded ${file}`);
        break;
      }
    } catch (err) {
      console.log(`Failed to load ${file}:`, err.message);
    }
  }
  
  if (!geojson) {
    throw new Error('Could not load GeoJSON file. Please ensure residential_suitability.geojson or Johannesburg_RDSI.geojson is in the same directory.');
  }
  
  if (!geojson.features || geojson.features.length === 0) {
    throw new Error('GeoJSON file has no features');
  }
  
  State.allFeatures = geojson.features.map(feature => {
    const props = feature.properties;
    
    const standNo = props.STAND_NO || props.SG_ID || 'UNKNOWN';
    const areaSqm = parseFloat(props.AREA_SQMT) || 0;
    const areaHa = areaSqm / 10000;
    const rdsiVal = parseFloat(props.RDSI) || 50;
    
    let category = props.Suitability;
    if (!category || (category !== 'High' && category !== 'Medium' && category !== 'Low')) {
      if (rdsiVal >= 80) category = 'High';
      else if (rdsiVal >= 60) category = 'Medium';
      else category = 'Low';
    }
    
    const roadDist = parseFloat(props.road_distance) || 2000;
    const schoolDist = parseFloat(props.school_distance) || 3000;
    const shoppingDist = parseFloat(props.shopping_distance) || 3000;
    
    let roadScore = parseFloat(props.road_score);
    if (isNaN(roadScore)) roadScore = Math.max(0, Math.min(100, 100 - (roadDist / 2000 * 100)));
    
    let schoolScore = parseFloat(props.school_score);
    if (isNaN(schoolScore)) schoolScore = Math.max(0, Math.min(100, 100 - (schoolDist / 3000 * 100)));
    
    let shoppingScore = parseFloat(props.shopping_score);
    if (isNaN(shoppingScore)) shoppingScore = Math.max(0, Math.min(100, 100 - (shoppingDist / 3000 * 100)));
    
    let sizeScore = parseFloat(props.size_score);
    if (isNaN(sizeScore)) sizeScore = Math.max(0, Math.min(100, (areaSqm / 1000) * 10));
    
    let slopeScore = parseFloat(props.slope_score);
    if (isNaN(slopeScore)) slopeScore = 50;
    
    const slopeVal = parseFloat(props.slope) || 0;
    
    let recommendation = '';
    if (rdsiVal >= 80) {
      recommendation = 'Highly suitable for residential development. Excellent access to amenities and favourable site conditions.';
    } else if (rdsiVal >= 60) {
      recommendation = 'Suitable for residential development with minor site-specific considerations.';
    } else if (rdsiVal >= 40) {
      recommendation = 'Moderate suitability. Further assessment required for infrastructure and geotechnical factors.';
    } else {
      recommendation = 'Limited suitability. Significant constraints identified. Consider alternative land uses or major remediation.';
    }
    
    return {
      type: feature.type,
      geometry: feature.geometry,
      properties: {
        parcel_id: String(standNo),
        area_sqm: areaSqm,
        area_ha: areaHa,
        rdsi: rdsiVal,
        suitability_category: category,
        road_dist: roadDist,
        school_dist: schoolDist,
        shopping_dist: shoppingDist,
        road_score: roadScore,
        school_score: schoolScore,
        shopping_score: shoppingScore,
        size_score: sizeScore,
        slope_score: slopeScore,
        mean_slope: slopeVal,
        max_slope: slopeVal,
        town: props.TOWN_NAME_ || 'Unknown',
        status: props.STATUS_DES || 'Unknown',
        land_type: props.LAND_TYPE_ || 'Unknown',
        recommendation: recommendation
      }
    };
  });
  
  State.filteredFeatures = [...State.allFeatures];
  
  console.log(`✅ Successfully loaded ${State.allFeatures.length} stands`);
  if (State.allFeatures.length > 0) {
    console.log('✅ Sample data:', State.allFeatures[0].properties);
  }
  
  return { type: "FeatureCollection", features: State.allFeatures };
};

/* ─── MAP ────────────────────────────────────────────────────── */
const initMap = (geojson) => {
  State.map = L.map('map', {
    zoomControl: false,
    attributionControl: false,
  });

  const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© OpenStreetMap contributors'
  });
  const carto = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 19, attribution: '© CartoDB'
  });
  const esri = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 18, attribution: '© Esri'
  });

  carto.addTo(State.map);

  L.control.zoom({ position: 'topleft' }).addTo(State.map);
  L.control.scale({ position: 'bottomleft', imperial: false }).addTo(State.map);
  L.control.layers({
    '◉ Dark (CartoDB)': carto,
    '◉ Standard (OSM)': osm,
    '◉ Satellite (Esri)': esri
  }, {}, { position: 'topright' }).addTo(State.map);

  renderGeoJSON(geojson);
  setTimeout(() => fitBounds(), 100);
};

/* ─── RENDER GEOJSON ──────────────────────────────────────────── */
const renderGeoJSON = (geojson) => {
  if (State.geojsonLayer) {
    State.map.removeLayer(State.geojsonLayer);
  }
  
  State.geojsonLayer = L.geoJSON(geojson, {
    style: feature => parcelStyle(feature, false),
    onEachFeature: (feature, layer) => {
      layer.featureData = feature;
      
      layer.on({
        mouseover: onParcelHover,
        mouseout: onParcelOut,
        click: onParcelClick
      });
    }
  }).addTo(State.map);
  
  State.selectedLayer = null;
  State.selectedParcel = null;
};

const parcelStyle = (feature, selected = false) => {
  if (!feature || !feature.properties) return {};
  
  const p = feature.properties;
  const col = rdsiColour(p.rdsi);
  return {
    fillColor: col,
    fillOpacity: selected ? 0.85 : 0.55,
    color: selected ? '#00d4ff' : col,
    weight: selected ? 2.5 : 1,
    opacity: 1,
  };
};

const onParcelHover = (e) => {
  const layer = e.target;
  const feature = layer.featureData;
  if (!feature) return;
  
  if (State.selectedParcel && State.selectedParcel.properties.parcel_id === feature.properties.parcel_id) return;
  
  layer.setStyle({ fillOpacity: 0.8, weight: 2, color: '#ffffff' });
  layer.bringToFront();

  const p = feature.properties;
  const cat = p.suitability_category;
  
  const popupContent = `
    <div class="map-popup" style="min-width: 280px;">
      <div class="popup-id">Stand #${p.parcel_id}</div>
      <div class="popup-row"><span class="popup-key">AREA</span><span class="popup-val">${p.area_sqm.toFixed(0)} m² (${p.area_ha.toFixed(2)} ha)</span></div>
      <div class="popup-row"><span class="popup-key">RDSI</span><span class="popup-val" style="color:${rdsiColour(p.rdsi)};font-weight:bold;">${p.rdsi}</span></div>
      <div class="popup-row"><span class="popup-key">ROAD</span><span class="popup-val">${p.road_dist.toFixed(0)} m | Score: ${p.road_score}</span></div>
      <div class="popup-row"><span class="popup-key">SCHOOL</span><span class="popup-val">${p.school_dist.toFixed(0)} m | Score: ${p.school_score}</span></div>
      <div class="popup-row"><span class="popup-key">SHOPPING</span><span class="popup-val">${p.shopping_dist.toFixed(0)} m | Score: ${p.shopping_score}</span></div>
      <div class="popup-row"><span class="popup-key">SIZE</span><span class="popup-val">Score: ${p.size_score}</span></div>
      <div class="popup-row"><span class="popup-key">SLOPE</span><span class="popup-val">${p.mean_slope}° | Score: ${p.slope_score}</span></div>
      <br/><span class="popup-cat ${cat}">${cat} Suitability</span>
    </div>
  `;
  
  layer.bindPopup(popupContent, {
    closeButton: true,
    autoPan: false,
    autoClose: true
  }).openPopup();
};

const onParcelOut = (e) => {
  const layer = e.target;
  const feature = layer.featureData;
  if (!feature) return;
  
  if (State.selectedParcel && State.selectedParcel.properties.parcel_id === feature.properties.parcel_id) return;
  
  const isSelected = State.selectedLayer === layer;
  layer.setStyle(parcelStyle(feature, isSelected));
  layer.closePopup();
};

const onParcelClick = (e) => {
  const layer = e.target;
  const feature = layer.featureData;
  if (!feature) return;
  
  L.DomEvent.stopPropagation(e);
  
  if (State.selectedLayer) {
    State.geojsonLayer.resetStyle(State.selectedLayer);
  }
  
  State.selectedParcel = feature;
  State.selectedLayer = layer;
  
  layer.setStyle({
    fillOpacity: 0.85,
    weight: 2.5,
    color: '#00d4ff'
  });
  layer.bringToFront();
  layer.closePopup();
  
  showParcelDetail(feature.properties);
  highlightTableRow(feature.properties.parcel_id);
};

const fitBounds = () => {
  if (State.geojsonLayer && State.map) {
    try { 
      const bounds = State.geojsonLayer.getBounds();
      if (bounds.isValid()) {
        State.map.fitBounds(bounds, { padding: [20, 20] });
      }
    } catch(e) {
      console.warn('Could not fit bounds:', e);
    }
  }
};

/* ─── APPLY MAP FILTER ─────────────────────────────────────────── */
const applyMapFilter = () => {
  const filteredGeoJSON = {
    type: "FeatureCollection",
    features: State.filteredFeatures
  };
  
  renderGeoJSON(filteredGeoJSON);
  
  const mosVisible = document.getElementById('mos-visible');
  if (mosVisible) {
    mosVisible.textContent = `${State.filteredFeatures.length} visible`;
  }
  
  State.selectedLayer = null;
  State.selectedParcel = null;
  
  if (State.filteredFeatures.length === 0) {
    const emptyDiv = document.getElementById('detail-empty');
    if (emptyDiv) {
      emptyDiv.style.display = 'block';
      emptyDiv.textContent = 'No parcels match the current filters. Try adjusting your criteria.';
    }
    const contentDiv = document.getElementById('detail-content');
    if (contentDiv) contentDiv.classList.add('hidden');
  }
  
  if (State.filteredFeatures.length > 0) {
    setTimeout(() => {
      try {
        const bounds = State.geojsonLayer.getBounds();
        if (bounds.isValid()) {
          State.map.fitBounds(bounds, { padding: [20, 20] });
        }
      } catch(e) {}
    }, 100);
  }
};

/* ─── PARCEL DETAIL ──────────────────────────────────────────── */
const showParcelDetail = (p) => {
  const emptyDiv = document.getElementById('detail-empty');
  const contentDiv = document.getElementById('detail-content');
  if (emptyDiv) {
    emptyDiv.style.display = 'none';
    emptyDiv.textContent = '';
  }
  if (contentDiv) contentDiv.classList.remove('hidden');
  
  const printBtn = document.getElementById('btn-print-parcel');
  if (printBtn) printBtn.style.display = '';

  const idEl = document.getElementById('detail-parcel-id');
  if (idEl) idEl.textContent = `Stand #${p.parcel_id}`;
  
  const badge = document.getElementById('detail-category-badge');
  if (badge) {
    badge.textContent = p.suitability_category;
    badge.className = 'cat-badge ' + p.suitability_category;
  }

  const gFill = document.getElementById('gauge-fill');
  if (gFill) {
    gFill.style.width = p.rdsi + '%';
    gFill.style.background = `linear-gradient(90deg, ${rdsiColour(Math.max(p.rdsi-20,0))}, ${rdsiColour(p.rdsi)})`;
  }
  
  const gaugeVal = document.getElementById('gauge-value');
  if (gaugeVal) gaugeVal.textContent = p.rdsi;

  const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setText('dm-area', `${p.area_sqm.toFixed(0)} m² (${p.area_ha.toFixed(2)} ha)`);
  setText('dm-road', `${p.road_dist.toFixed(0)} m (Score: ${p.road_score})`);
  setText('dm-school', `${p.school_dist.toFixed(0)} m (Score: ${p.school_score})`);
  setText('dm-settlement', `${p.shopping_dist.toFixed(0)} m (Score: ${p.shopping_score})`);
  setText('dm-slope-mean', `${p.mean_slope}° (Score: ${p.slope_score})`);
  setText('dm-slope-max', `${p.max_slope}°`);
  setText('rec-text', p.recommendation);

  const maxDists = { road: 2000, school: 3000, shopping: 3000 };
  const bar = (id, val, max, valEl) => {
    const pct = Math.max(0, Math.min(100, 100 - (val / max * 100)));
    const barEl = document.getElementById('ab-' + id);
    if (barEl) {
      barEl.style.width = pct + '%';
      const col = pct > 60 ? 'var(--col-high)' : pct > 30 ? 'var(--col-medium)' : 'var(--col-low)';
      barEl.style.background = col;
    }
    const valSpan = document.getElementById('abv-' + valEl);
    if (valSpan) valSpan.textContent = val.toFixed(0) + 'm';
  };
  bar('road', p.road_dist, maxDists.road, 'road');
  bar('school', p.school_dist, maxDists.school, 'school');
  bar('settlement', p.shopping_dist, maxDists.shopping, 'settlement');
  
  let scoreContainer = document.getElementById('score-bars');
  if (!scoreContainer) {
    const accessBars = document.getElementById('detail-access-bars');
    if (accessBars) {
      scoreContainer = document.createElement('div');
      scoreContainer.id = 'score-bars';
      scoreContainer.style.marginTop = '12px';
      scoreContainer.style.marginBottom = '8px';
      accessBars.insertAdjacentElement('afterend', scoreContainer);
    }
  }
  
  if (scoreContainer) {
    scoreContainer.innerHTML = `
      <div class="ab-label">COMPONENT SCORES (0-100)</div>
      <div class="ab-row"><span class="ab-name">Road Access</span><div class="ab-track"><div class="ab-fill" style="width:${p.road_score}%; background:${scoreColour(p.road_score)}"></div></div><span class="ab-val">${p.road_score}</span></div>
      <div class="ab-row"><span class="ab-name">School Access</span><div class="ab-track"><div class="ab-fill" style="width:${p.school_score}%; background:${scoreColour(p.school_score)}"></div></div><span class="ab-val">${p.school_score}</span></div>
      <div class="ab-row"><span class="ab-name">Shopping Access</span><div class="ab-track"><div class="ab-fill" style="width:${p.shopping_score}%; background:${scoreColour(p.shopping_score)}"></div></div><span class="ab-val">${p.shopping_score}</span></div>
      <div class="ab-row"><span class="ab-name">Parcel Size</span><div class="ab-track"><div class="ab-fill" style="width:${p.size_score}%; background:${scoreColour(p.size_score)}"></div></div><span class="ab-val">${p.size_score}</span></div>
      <div class="ab-row"><span class="ab-name">Slope</span><div class="ab-track"><div class="ab-fill" style="width:${p.slope_score}%; background:${scoreColour(p.slope_score)}"></div></div><span class="ab-val">${p.slope_score}</span></div>
    `;
  }
};

/* ─── KPI CARDS ──────────────────────────────────────────────── */
const updateKPIs = () => {
  const ff = State.filteredFeatures;
  const total = ff.length;
  const high = ff.filter(f => f.properties.suitability_category === 'High').length;
  const medium = ff.filter(f => f.properties.suitability_category === 'Medium').length;
  const low = ff.filter(f => f.properties.suitability_category === 'Low').length;
  const avgRdsi = total ? (ff.reduce((s, f) => s + f.properties.rdsi, 0) / total).toFixed(1) : 0;

  const kvTotal = document.getElementById('kv-total');
  const kvRdsi = document.getElementById('kv-rdsi');
  const kvHigh = document.getElementById('kv-high');
  const kvMedium = document.getElementById('kv-medium');
  const kvLow = document.getElementById('kv-low');
  
  if (kvTotal) kvTotal.textContent = total;
  if (kvRdsi) kvRdsi.textContent = avgRdsi;
  if (kvHigh) kvHigh.textContent = high;
  if (kvMedium) kvMedium.textContent = medium;
  if (kvLow) kvLow.textContent = low;

  const badgeCount = document.getElementById('badge-count');
  if (badgeCount) badgeCount.textContent = total + ' stands';

  if (total > 0) {
    const kbHigh = document.getElementById('kb-high');
    const kbMedium = document.getElementById('kb-medium');
    const kbLow = document.getElementById('kb-low');
    if (kbHigh) kbHigh.style.width = (high/total*100) + '%';
    if (kbMedium) kbMedium.style.width = (medium/total*100) + '%';
    if (kbLow) kbLow.style.width = (low/total*100) + '%';
  }
};

/* ─── FILTERS ────────────────────────────────────────────────── */
const getActiveCategories = () => {
  const checkboxes = document.querySelectorAll('.cat-filter:checked');
  return checkboxes ? [...checkboxes].map(cb => cb.value) : ['High', 'Medium', 'Low'];
};

const applyFilters = () => {
  const cats = getActiveCategories();
  const minRdsi = parseFloat(document.getElementById('rdsi-min')?.value) || 0;
  const maxRdsi = parseFloat(document.getElementById('rdsi-max')?.value) || 100;
  
  State.filteredFeatures = State.allFeatures.filter(f => {
    const p = f.properties;
    return cats.includes(p.suitability_category) && p.rdsi >= minRdsi && p.rdsi <= maxRdsi;
  });
  
  State.tablePage = 1;
  updateKPIs();
  updateAllCharts();
  updateTable();
  applyMapFilter();
  
  console.log(`Filters applied: ${State.filteredFeatures.length} of ${State.allFeatures.length} parcels visible`);
};

const resetFilters = () => {
  const catFilters = document.querySelectorAll('.cat-filter');
  catFilters.forEach(cb => cb.checked = true);
  
  const rdsiMin = document.getElementById('rdsi-min');
  const rdsiMax = document.getElementById('rdsi-max');
  if (rdsiMin) rdsiMin.value = 0;
  if (rdsiMax) rdsiMax.value = 100;
  
  const parcelSearch = document.getElementById('parcel-search-sidebar');
  if (parcelSearch) parcelSearch.value = '';
  
  State.filteredFeatures = [...State.allFeatures];
  State.tablePage = 1;
  State.tableSearch = '';
  const tableSearch = document.getElementById('table-search');
  if (tableSearch) tableSearch.value = '';
  
  updateKPIs();
  updateAllCharts();
  updateTable();
  applyMapFilter();
  
  console.log('All filters reset');
};

/* ─── PARCEL SEARCH ────────────────────────────────────────────── */
const searchParcel = (query) => {
  if (!query || query.trim() === '') {
    applyFilters();
    return;
  }
  
  const q = query.trim().toLowerCase().replace(/^#+/, '');
  const matches = State.allFeatures.filter(f => 
    String(f.properties.parcel_id).toLowerCase().includes(q)
  );

  if (!matches.length) {
    console.log(`Parcel "${query}" not found`);
    const emptyDiv = document.getElementById('detail-empty');
    const contentDiv = document.getElementById('detail-content');
    if (emptyDiv) {
      emptyDiv.style.display = 'block';
      emptyDiv.textContent = `Parcel #${query} not found. Try adjusting your filters.`;
    }
    if (contentDiv) contentDiv.classList.add('hidden');
    return;
  }

  const visibleMatches = State.filteredFeatures.filter(f => 
    matches.some(m => m.properties.parcel_id === f.properties.parcel_id)
  );

  if (visibleMatches.length) {
    State.filteredFeatures = visibleMatches;
  } else {
    State.filteredFeatures = matches;
  }

  updateKPIs();
  updateAllCharts();
  updateTable();
  applyMapFilter();

  const selected = State.filteredFeatures[0];
  if (selected) {
    selectParcelById(selected.properties.parcel_id);
  }
};

/* ─── CHARTS ─────────────────────────────────────────────────── */
const chartDefaults = () => ({
  animation: { duration: 350 },
  responsive: true,
  maintainAspectRatio: true,
  plugins: {
    legend: {
      labels: { color: '#a0b4cc', font: { family: "'Barlow', sans-serif", size: 11 }, boxWidth: 12 }
    },
    tooltip: {
      backgroundColor: '#161f2e', borderColor: '#1f2d45', borderWidth: 1,
      titleColor: '#e8eef8', bodyColor: '#a0b4cc',
      titleFont: { family: "'Rajdhani', sans-serif", size: 13, weight: 'bold' },
      bodyFont: { family: "'JetBrains Mono', monospace", size: 11 },
      padding: 10,
    }
  },
  scales: {}
});

const makeScales = () => ({
  x: {
    grid: { color: '#1f2d45' },
    ticks: { color: '#5a7090', font: { family: "'JetBrains Mono', monospace", size: 10 } }
  },
  y: {
    grid: { color: '#1f2d45' },
    ticks: { color: '#5a7090', font: { family: "'JetBrains Mono', monospace", size: 10 } }
  }
});

const destroyChart = key => {
  if (State.charts[key]) { 
    State.charts[key].destroy(); 
    delete State.charts[key]; 
  }
};

const buildRdsiDistChart = () => {
  destroyChart('rdsiDist');
  const ctx = document.getElementById('chart-rdsi-dist');
  if (!ctx) return;
  
  const bins = [0,0,0,0,0];
  State.filteredFeatures.forEach(f => {
    const r = f.properties.rdsi;
    if (r < 20) bins[0]++;
    else if (r < 40) bins[1]++;
    else if (r < 60) bins[2]++;
    else if (r < 80) bins[3]++;
    else bins[4]++;
  });
  
  const opts = chartDefaults();
  opts.scales = makeScales();
  opts.plugins.legend.display = false;
  
  State.charts.rdsiDist = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['0–19', '20–39', '40–59', '60–79', '80–100'],
      datasets: [{
        label: 'Stands',
        data: bins,
        backgroundColor: ['#ef4444cc', '#ef4444cc', '#f97316cc', '#f59e0bcc', '#10b981cc'],
        borderColor: ['#ef4444', '#ef4444', '#f97316', '#f59e0b', '#10b981'],
        borderWidth: 1, borderRadius: 4,
      }]
    },
    options: opts
  });
};

const buildCatPieChart = () => {
  destroyChart('catPie');
  const ctx = document.getElementById('chart-cat-pie');
  if (!ctx) return;
  
  const counts = { High: 0, Medium: 0, Low: 0 };
  State.filteredFeatures.forEach(f => {
    const c = f.properties.suitability_category;
    if (counts[c] !== undefined) counts[c]++;
  });
  
  const opts = chartDefaults();
  opts.plugins.legend.position = 'right';
  
  State.charts.catPie = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['High', 'Medium', 'Low'],
      datasets: [{
        data: [counts.High, counts.Medium, counts.Low],
        backgroundColor: ['#10b98166', '#f59e0b66', '#ef444466'],
        borderColor: ['#10b981', '#f59e0b', '#ef4444'],
        borderWidth: 2, hoverOffset: 8,
      }]
    },
    options: opts
  });
};

const buildTop10Chart = () => {
  destroyChart('top10');
  const ctx = document.getElementById('chart-top10');
  if (!ctx) return;
  
  const top10 = [...State.filteredFeatures]
    .sort((a, b) => b.properties.rdsi - a.properties.rdsi)
    .slice(0, 10);
  
  const opts = chartDefaults();
  opts.scales = makeScales();
  opts.indexAxis = 'y';
  opts.plugins.legend.display = false;
  opts.scales.x.max = 100;
  
  State.charts.top10 = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: top10.map(f => `#${f.properties.parcel_id}`),
      datasets: [{
        label: 'RDSI',
        data: top10.map(f => f.properties.rdsi),
        backgroundColor: top10.map(f => rdsiColour(f.properties.rdsi) + 'aa'),
        borderColor: top10.map(f => rdsiColour(f.properties.rdsi)),
        borderWidth: 1, borderRadius: 4,
      }]
    },
    options: opts
  });
};

const buildAvgRdsiChart = () => {
  destroyChart('avgRdsi');
  const ctx = document.getElementById('chart-avg-rdsi');
  if (!ctx) return;
  
  const cats = ['High', 'Medium', 'Low'];
  const avgs = cats.map(cat => {
    const arr = State.filteredFeatures.filter(f => f.properties.suitability_category === cat);
    if (!arr.length) return 0;
    return +(arr.reduce((s, f) => s + f.properties.rdsi, 0) / arr.length).toFixed(1);
  });
  
  const opts = chartDefaults();
  opts.scales = makeScales();
  opts.plugins.legend.display = false;
  opts.scales.y.max = 100;
  
  State.charts.avgRdsi = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: cats,
      datasets: [{
        label: 'Avg RDSI',
        data: avgs,
        backgroundColor: ['#10b98166', '#f59e0b66', '#ef444466'],
        borderColor: ['#10b981', '#f59e0b', '#ef4444'],
        borderWidth: 1, borderRadius: 6,
      }]
    },
    options: opts
  });
};

const updateAllCharts = () => {
  buildRdsiDistChart();
  buildCatPieChart();
  buildTop10Chart();
  buildAvgRdsiChart();
};

/* ─── RANKING TABLE ──────────────────────────────────────────── */
const getSortedFilteredRows = () => {
  let rows = [...State.filteredFeatures];
  const q = State.tableSearch.trim().toLowerCase();
  if (q) rows = rows.filter(f => String(f.properties.parcel_id).toLowerCase().includes(q));
  
  const col = State.tableSort.col;
  const dir = State.tableSort.dir === 'asc' ? 1 : -1;
  
  rows.sort((a, b) => {
    let av = a.properties[col];
    let bv = b.properties[col];
    
    if (col === 'area_ha') {
      av = a.properties.area_ha;
      bv = b.properties.area_ha;
    }
    
    if (typeof av === 'number') return (av - bv) * dir;
    return String(av).localeCompare(String(bv)) * dir;
  });
  
  return rows;
};

const updateTable = () => {
  const rows = getSortedFilteredRows();
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / State.tablePageSize));
  if (State.tablePage > pages) State.tablePage = pages;
  const start = (State.tablePage - 1) * State.tablePageSize;
  const slice = rows.slice(start, start + State.tablePageSize);

  const tbody = document.getElementById('ranking-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  
  slice.forEach(f => {
    const p = f.properties;
    const tr = document.createElement('tr');
    if (State.selectedParcel?.properties.parcel_id === p.parcel_id) tr.classList.add('row-selected');
    tr.dataset.pid = p.parcel_id;
    tr.innerHTML = `
      <td class="td-id">#${p.parcel_id}</td>
      <td>${p.area_sqm.toFixed(0)} m²</td>
      <td class="td-rdsi ${rdsiClass(p.rdsi)}">${p.rdsi}</td>
      <td class="td-cat"><span class="cat-pill ${p.suitability_category}">${p.suitability_category}</span></td>
      <td>${p.road_dist.toFixed(0)}</td>
      <td>${p.school_dist.toFixed(0)}</td>
      <td>${p.mean_slope}°</td>
      <td><button class="btn-table-zoom" data-pid="${p.parcel_id}">⊕ Select</button></td>
    `;
    tr.addEventListener('click', (e) => {
      if (!e.target.classList.contains('btn-table-zoom')) {
        selectParcelById(p.parcel_id);
      }
    });
    tbody.appendChild(tr);
  });

  const pagInfo = document.getElementById('pagination-info');
  if (pagInfo) {
    pagInfo.textContent = `Showing ${start + 1}–${Math.min(start + State.tablePageSize, total)} of ${total} stands`;
  }

  const pn = document.getElementById('page-numbers');
  if (pn) {
    pn.innerHTML = '';
    const maxPgs = 5;
    let s = Math.max(1, State.tablePage - 2);
    let e = Math.min(pages, s + maxPgs - 1);
    if (e - s < maxPgs - 1) s = Math.max(1, e - maxPgs + 1);
    for (let i = s; i <= e; i++) {
      const btn = document.createElement('button');
      btn.className = 'page-num' + (i === State.tablePage ? ' active' : '');
      btn.textContent = i;
      btn.addEventListener('click', () => { State.tablePage = i; updateTable(); });
      pn.appendChild(btn);
    }
  }

  const prevBtn = document.getElementById('btn-prev-page');
  const nextBtn = document.getElementById('btn-next-page');
  if (prevBtn) prevBtn.disabled = State.tablePage === 1;
  if (nextBtn) nextBtn.disabled = State.tablePage === pages;

  document.querySelectorAll('.th-sortable').forEach(th => {
    th.classList.toggle('active-sort', th.dataset.col === State.tableSort.col);
    const arrow = th.querySelector('.sort-arrow');
    if (arrow) {
      if (th.dataset.col === State.tableSort.col) {
        arrow.textContent = State.tableSort.dir === 'asc' ? '↑' : '↓';
      } else { arrow.textContent = '↕'; }
    }
  });

  tbody.querySelectorAll('.btn-table-zoom').forEach(btn => {
    btn.addEventListener('click', (e) => { 
      e.stopPropagation(); 
      selectParcelById(btn.dataset.pid); 
    });
  });
};

const selectParcelById = (pid) => {
  const feature = State.allFeatures.find(f => f.properties.parcel_id === pid);
  if (!feature) return;
  
  showParcelDetail(feature.properties);
  State.selectedParcel = feature;

  switchView('dashboard');

  let targetLayer = null;
  State.geojsonLayer.eachLayer(layer => {
    if (layer.featureData?.properties?.parcel_id === pid) {
      targetLayer = layer;
    }
  });
  
  if (targetLayer) {
    if (State.selectedLayer) {
      State.geojsonLayer.resetStyle(State.selectedLayer);
    }
    State.selectedLayer = targetLayer;
    targetLayer.setStyle({ fillOpacity: 0.85, weight: 2.5, color: '#00d4ff' });
    targetLayer.bringToFront();
    targetLayer.closePopup();
    
    try { 
      const bounds = targetLayer.getBounds();
      if (bounds.isValid()) {
        State.map.flyToBounds(bounds, { duration: 0.8 });
      }
    } catch(e) {}
  }
  
  highlightTableRow(pid);
};

const highlightTableRow = (pid) => {
  document.querySelectorAll('#ranking-tbody tr').forEach(tr => {
    tr.classList.toggle('row-selected', tr.dataset.pid === pid);
  });
};

/* ─── VIEW NAVIGATION ────────────────────────────────────────── */
const viewMeta = {
  dashboard: 'Executive Dashboard',
  map: 'Parcel Map',
  analytics: 'Analytics',
  ranking: 'Rankings',
  report: 'Reports'
};

const switchView = (view) => {
  document.querySelectorAll('.view-panel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById('view-' + view);
  if (panel) panel.classList.add('active');

  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.view === view);
  });

  const breadcrumb = document.getElementById('breadcrumb-current');
  if (breadcrumb) breadcrumb.textContent = viewMeta[view] || view;

  if (view === 'dashboard' || view === 'map') {
    setTimeout(() => State.map?.invalidateSize(), 100);
  }
  if (view === 'analytics') {
    setTimeout(updateAllCharts, 100);
  }
};

/* ─── PRINT / REPORT (FULLY FIXED - READS FROM DOM) ──────────── */
const showPrintOverlay = (mode = 'summary') => {
  const overlay = document.getElementById('print-overlay');
  if (overlay) overlay.classList.remove('hidden');

  const now = new Date();
  const printDate = document.getElementById('print-date');
  const printRef = document.getElementById('print-ref');
  const printYear = document.getElementById('print-year');
  if (printDate) printDate.textContent = now.toLocaleDateString('en-ZA', { year: 'numeric', month: 'long', day: 'numeric' }) + ' ' + now.toLocaleTimeString('en-ZA');
  if (printRef) printRef.textContent = 'REF: MRDIP-' + Date.now().toString(36).toUpperCase();
  if (printYear) printYear.textContent = now.getFullYear();

  const body = document.getElementById('print-body');
  const ff = State.filteredFeatures;
  const total = ff.length;
  const high = ff.filter(f => f.properties.suitability_category === 'High').length;
  const med = ff.filter(f => f.properties.suitability_category === 'Medium').length;
  const low = ff.filter(f => f.properties.suitability_category === 'Low').length;
  const avgRdsi = total ? (ff.reduce((s, f) => s + f.properties.rdsi, 0) / total).toFixed(1) : 0;

  // ★★★★★ CRITICAL FIX: Read checkbox states directly from DOM ★★★★★
  // This ensures we always use the current UI state, not stale JavaScript state
  
  // Read checkbox states from the DOM explicitly by input selector
  const kpisCheckbox = document.querySelector('input.rpt-include[value="kpis"]');
  const tableCheckbox = document.querySelector('input.rpt-include[value="table"]');
  const detailCheckbox = document.querySelector('input.rpt-include[value="detail"]');

  const kpisChecked = Boolean(kpisCheckbox?.checked);
  const tableChecked = Boolean(tableCheckbox?.checked);
  const detailChecked = Boolean(detailCheckbox?.checked);

  console.log('📊 Report generation - Current checkbox states:', { 
    kpisChecked, 
    tableChecked, 
    detailChecked,
    reportType: State.reportType || mode
  });

  let html = '';

  // KPI Summary Section
  if (kpisChecked) {
    html += `<div class="print-section-title">EXECUTIVE SUMMARY — KEY PERFORMANCE INDICATORS</div>
    <div class="print-kpi-row">
      <div class="print-kpi"><div class="print-kpi-val">${total}</div><div class="print-kpi-lbl">TOTAL STANDS ANALYSED</div></div>
      <div class="print-kpi"><div class="print-kpi-val">${avgRdsi}</div><div class="print-kpi-lbl">AVERAGE RDSI SCORE</div></div>
      <div class="print-kpi"><div class="print-kpi-val">${high}</div><div class="print-kpi-lbl">HIGH SUITABILITY</div></div>
      <div class="print-kpi"><div class="print-kpi-val">${med}</div><div class="print-kpi-lbl">MEDIUM SUITABILITY</div></div>
      <div class="print-kpi"><div class="print-kpi-val">${low}</div><div class="print-kpi-lbl">LOW SUITABILITY</div></div>
    </div>`;
  }

  // Parcel Table Section
  if (tableChecked) {
    let reportRows;
    const reportType = State.reportType || mode || 'summary';
    
    if (reportType === 'topten') {
      reportRows = [...ff].sort((a, b) => b.properties.rdsi - a.properties.rdsi).slice(0, 10);
    } else if (reportType === 'filtered') {
      reportRows = [...ff].sort((a, b) => b.properties.rdsi - a.properties.rdsi);
    } else {
      reportRows = [...ff].sort((a, b) => b.properties.rdsi - a.properties.rdsi).slice(0, 20);
    }
    
    const title = reportType === 'topten' ? 'TOP 10 HIGHEST RANKED STANDS' : 
                  reportType === 'filtered' ? 'FILTERED STAND SUITABILITY TABLE' : 
                  'STAND SUITABILITY SUMMARY TABLE';
    html += `<div class="print-section-title">${title}</div>
    <table class="print-table">
      <thead>
        <tr>
          <th>STAND NO</th><th>AREA</th><th>RDSI</th><th>CATEGORY</th>
          <th>ROAD (m)</th><th>SCHOOL (m)</th><th>SLOPE (°)</th><th>RECOMMENDATION</th>
        </tr>
      </thead>
      <tbody>
        ${reportRows.map(f => {
          const p = f.properties;
          return `<tr>
            <td><strong>#${p.parcel_id}</strong></td>
            <td>${p.area_sqm.toFixed(0)} m²</td>
            <td><strong>${p.rdsi}</strong></td>
            <td>${p.suitability_category}</td>
            <td>${p.road_dist.toFixed(0)}</td>
            <td>${p.school_dist.toFixed(0)}</td>
            <td>${p.mean_slope}°</td>
            <td>${p.recommendation.substring(0, 80)}...</td>
           </tr>`;
        }).join('')}
      </tbody>
    </table>`;
  }

  // Selected Parcel Detail Section
  if (detailChecked && State.selectedParcel) {
    const p = State.selectedParcel.properties;
    html += `<div class="print-section-title">SELECTED STAND DETAILED ASSESSMENT — #${p.parcel_id}</div>
    <div class="print-parcel-grid">
      <div class="print-parcel-field"><div class="print-parcel-key">STAND NUMBER</div><div class="print-parcel-val">#${p.parcel_id}</div></div>
      <div class="print-parcel-field"><div class="print-parcel-key">AREA</div><div class="print-parcel-val">${p.area_sqm.toFixed(0)} m² (${p.area_ha.toFixed(2)} ha)</div></div>
      <div class="print-parcel-field"><div class="print-parcel-key">RDSI SCORE</div><div class="print-parcel-val">${p.rdsi} / 100</div></div>
      <div class="print-parcel-field"><div class="print-parcel-key">SUITABILITY</div><div class="print-parcel-val">${p.suitability_category}</div></div>
      <div class="print-parcel-field"><div class="print-parcel-key">ROAD DISTANCE</div><div class="print-parcel-val">${p.road_dist.toFixed(0)} m (Score: ${p.road_score})</div></div>
      <div class="print-parcel-field"><div class="print-parcel-key">SCHOOL DISTANCE</div><div class="print-parcel-val">${p.school_dist.toFixed(0)} m (Score: ${p.school_score})</div></div>
      <div class="print-parcel-field"><div class="print-parcel-key">SHOPPING DISTANCE</div><div class="print-parcel-val">${p.shopping_dist.toFixed(0)} m (Score: ${p.shopping_score})</div></div>
      <div class="print-parcel-field"><div class="print-parcel-key">MEAN SLOPE</div><div class="print-parcel-val">${p.mean_slope}° (Score: ${p.slope_score})</div></div>
      <div class="print-parcel-field"><div class="print-parcel-key">SIZE SCORE</div><div class="print-parcel-val">${p.size_score}</div></div>
    </div>
    <div class="print-rec"><strong>Planning Recommendation:</strong> ${p.recommendation}</div>`;
  }

  if (!html) {
    html = '<p style="color: #a0b4cc; text-align: center; padding: 40px;">Please select at least one section to include in the report.</p>';
  }

  if (body) body.innerHTML = html;
};

const updateReportPreviewPanel = () => {
  const preview = document.getElementById('report-preview');
  if (!preview) return;

  const kpisChecked = document.querySelector('input.rpt-include[value="kpis"]')?.checked;
  const tableChecked = document.querySelector('input.rpt-include[value="table"]')?.checked;
  const detailChecked = document.querySelector('input.rpt-include[value="detail"]')?.checked;
  const activeType = document.querySelector('.report-type-btn.active')?.dataset.type || State.reportType || 'summary';

  const sections = [];
  if (kpisChecked) sections.push('KPI Summary');
  if (tableChecked) sections.push('Parcel Table');
  if (detailChecked) sections.push('Selected Parcel Detail');

  if (sections.length === 0) {
    preview.innerHTML = '<div class="empty-icon">⚠</div><p>Please choose at least one section to include in the report.</p>';
    return;
  }

  preview.innerHTML = `<div class="report-preview-summary">
    <div><strong>Report type:</strong> ${activeType === 'topten' ? 'Top 10 Parcels' : activeType === 'filtered' ? 'Filtered Results' : 'Summary Report'}</div>
    <div><strong>Included sections:</strong> ${sections.join(', ')}</div>
    <p class="report-preview-note">Click "Generate Summary Report" to preview the selected sections in the printable report overlay.</p>
  </div>`;
};

/* ─── LABELS ─────────────────────────────────────────────────── */
const toggleLabels = () => {
  State.labelLayers.forEach(l => State.map?.removeLayer(l));
  State.labelLayers = [];
  if (!State.labelsVisible) return;
  
  State.filteredFeatures.slice(0, 200).forEach(f => {
    const p = f.properties;
    const geom = f.geometry;
    if (!geom || !geom.coordinates) return;
    
    let coords = geom.type === 'Polygon' ? geom.coordinates[0] : geom.coordinates[0][0];
    if (!coords || !coords.length) return;
    
    const lng = coords.reduce((s, c) => s + c[0], 0) / coords.length;
    const lat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
    
    const marker = L.marker([lat, lng], {
      icon: L.divIcon({
        className: '',
        html: `<div style="background:rgba(13,20,32,0.85);border:1px solid #1f2d45;color:#a0b4cc;font-family:'JetBrains Mono',monospace;font-size:9px;padding:2px 5px;border-radius:3px;white-space:nowrap;">#${p.parcel_id}</div>`,
        iconAnchor: [0, 0]
      })
    });
    marker.addTo(State.map);
    State.labelLayers.push(marker);
  });
};

/* ─── INIT EVENTS ────────────────────────────────────────────── */
const initEvents = () => {
  // Sidebar toggle
  const toggleBtn = document.getElementById('btn-sidebar-toggle');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      document.getElementById('sidebar')?.classList.toggle('collapsed');
      setTimeout(() => State.map?.invalidateSize(), 250);
    });
  }

  // Navigation
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', e => {
      e.preventDefault();
      switchView(item.dataset.view);
    });
  });

  // Filter buttons
  const applyBtn = document.getElementById('btn-apply-filters');
  if (applyBtn) applyBtn.addEventListener('click', applyFilters);

  const resetBtn = document.getElementById('btn-reset-filters');
  if (resetBtn) resetBtn.addEventListener('click', resetFilters);

  // Category checkboxes
  document.querySelectorAll('.cat-filter').forEach(cb => cb.addEventListener('change', applyFilters));

  // RDSI range inputs
  ['rdsi-min', 'rdsi-max'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('keydown', e => { if (e.key === 'Enter') applyFilters(); });
  });

  // Parcel search sidebar
  const pss = document.getElementById('parcel-search-sidebar');
  if (pss) {
    pss.addEventListener('input', () => {
      clearTimeout(State.parcelSearchTimeout);
      State.parcelSearchTimeout = setTimeout(() => searchParcel(pss.value), 500);
    });
  }

  // Table search
  const ts = document.getElementById('table-search');
  let tableSearchTimer;
  if (ts) {
    ts.addEventListener('input', () => {
      clearTimeout(tableSearchTimer);
      tableSearchTimer = setTimeout(() => {
        State.tableSearch = ts.value;
        State.tablePage = 1;
        updateTable();
      }, 250);
    });
  }

  // Table sort
  document.querySelectorAll('.th-sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (State.tableSort.col === col) {
        State.tableSort.dir = State.tableSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        State.tableSort.col = col;
        State.tableSort.dir = 'desc';
      }
      updateTable();
    });
  });

  // Pagination
  const prevPageBtn = document.getElementById('btn-prev-page');
  if (prevPageBtn) {
    prevPageBtn.addEventListener('click', () => {
      if (State.tablePage > 1) { State.tablePage--; updateTable(); }
    });
  }

  const nextPageBtn = document.getElementById('btn-next-page');
  if (nextPageBtn) {
    nextPageBtn.addEventListener('click', () => {
      const total = getSortedFilteredRows().length;
      const pages = Math.ceil(total / State.tablePageSize);
      if (State.tablePage < pages) { State.tablePage++; updateTable(); }
    });
  }

  // Fit bounds
  const fitBtn = document.getElementById('btn-fit-bounds');
  if (fitBtn) fitBtn.addEventListener('click', fitBounds);

  const fitFullBtn = document.getElementById('btn-fit-full');
  if (fitFullBtn) fitFullBtn.addEventListener('click', fitBounds);

  // Labels toggle
  const toggleLabelsBtn = document.getElementById('btn-toggle-labels');
  if (toggleLabelsBtn) {
    toggleLabelsBtn.addEventListener('click', () => {
      State.labelsVisible = !State.labelsVisible;
      toggleLabels();
    });
  }

  // === REPORT CONTROLS (FULLY FIXED) ===
  
  // 1. Report Type - Dropdown or Radio buttons
  // Try to find a report type selector
  const reportSelect = document.getElementById('reportTypeSelect');
  if (reportSelect) {
    reportSelect.value = State.reportType || 'summary';
    reportSelect.addEventListener('change', function() {
      State.reportType = this.value;
      console.log('📋 Report type set to:', State.reportType);
    });
  }
  
  // Also handle radio buttons if they exist
  document.querySelectorAll('input[name="reportType"]').forEach(radio => {
    radio.addEventListener('change', function() {
      if (this.checked) {
        State.reportType = this.value;
        console.log('📋 Report type set to:', State.reportType);
      }
    });
  });

  // Report type button group - update active class and state when clicked
  document.querySelectorAll('.report-type-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.report-type-btn').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      State.reportType = this.dataset.type;
      console.log('📋 Report type set to:', State.reportType);
    });
  });

  // 2. Section checkboxes - log changes and update preview
  document.querySelectorAll('input.rpt-include').forEach(cb => {
    cb.addEventListener('change', function() {
      console.log('📋 Section checkbox:', this.value, this.checked ? '✓ included' : '✗ excluded');
      updateReportPreviewPanel();
    });
  });

  // Initialize report preview based on current options
  updateReportPreviewPanel();

  // 3. Generate Report buttons
  const generateButtons = [
    document.getElementById('btn-print-report'),
    document.getElementById('btn-gen-summary'),
    document.getElementById('btn-generate-report')
  ];
  
  generateButtons.forEach(btn => {
    if (btn) {
      btn.addEventListener('click', function() {
        // Read current report type from dropdown or radio
        const select = document.getElementById('reportTypeSelect');
        if (select) {
          State.reportType = select.value;
        } else {
          const checkedRadio = document.querySelector('input[name="reportType"]:checked');
          if (checkedRadio) {
            State.reportType = checkedRadio.value;
          }
        }
        
        console.log('🖨️ Generating report with type:', State.reportType);
        showPrintOverlay(State.reportType);
      });
    }
  });

  // 4. Print execution button
  const printExecBtn = document.getElementById('btn-print-exec');
  if (printExecBtn) {
    printExecBtn.addEventListener('click', () => {
      window.print();
    });
  }

  // 5. Print close button
  const printCloseBtn = document.getElementById('btn-print-close');
  if (printCloseBtn) {
    printCloseBtn.addEventListener('click', () => {
      document.getElementById('print-overlay')?.classList.add('hidden');
    });
  }

  // 6. Print parcel button
  const printParcelBtn = document.getElementById('btn-print-parcel');
  if (printParcelBtn) {
    printParcelBtn.addEventListener('click', () => {
      // Force detail checkbox checked
      const detailCb = document.querySelector('input.rpt-include[value="detail"]');
      if (detailCb) detailCb.checked = true;
      State.reportType = 'detail';
      updateReportPreviewPanel();
      showPrintOverlay('detail');
    });
  }
};

/* ─── BOOTSTRAP ──────────────────────────────────────────────── */
const bootstrap = async () => {
  Loading.init();
  Loading.set(10, 0);

  startClock();

  Loading.set(25, 1);
  let geojson;
  try {
    geojson = await loadData();
  } catch (err) {
    console.error(err);
    const msgEl = document.getElementById('loading-msg');
    if (msgEl) {
      msgEl.textContent = 'Error loading data: ' + err.message;
      msgEl.style.color = '#ef4444';
    }
    return;
  }

  Loading.set(45, 2);
  initMap(geojson);

  Loading.set(60, 3);
  updateKPIs();

  Loading.set(75, 4);
  updateAllCharts();

  Loading.set(88, 5);
  updateTable();

  Loading.set(98, 6);
  initEvents();

  Loading.set(100, 6);
  setTimeout(() => Loading.hide(), 500);

  const mosVisible = document.getElementById('mos-visible');
  if (mosVisible) mosVisible.textContent = `${State.allFeatures.length} visible`;
  
  console.log('✅ MRDIP Platform Ready!');
};

// Start the application
document.addEventListener('DOMContentLoaded', bootstrap);