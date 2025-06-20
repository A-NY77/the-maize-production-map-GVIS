const geojsonUrl = 'data.geojson';
const view = new ol.View({ center: [0, 0], zoom: 3 });
const mapA = new ol.Map({ target: 'mapA', layers: [], view });
const mapB = new ol.Map({ target: 'mapB', layers: [], view });

let layerA = null;
let layerB = null;

function getBreakClass(v, breaks) {
  if (!breaks?.length || v == null || isNaN(v)) return 0;
  for (let i = 0; i < breaks.length - 1; i++) {
    if (v >= breaks[i] && v <= breaks[i + 1]) return i;
  }
  return breaks.length - 2;
}

function createLayerByMode(mode, year, done) {
  fetch(geojsonUrl).then(r => r.json()).then(data => {
    const format = new ol.format.GeoJSON();
    const features = format.readFeatures(data, { featureProjection: 'EPSG:3857' });
    if (!features.length) return done(null);

    if (mode === 'yield') {
      const fld = `Yield_${year}`;
      const vals = features.map(f => f.get(fld)).filter(v => typeof v === 'number');
      const breaks = ss.jenks(vals, 5);
      const ramp = ['#edf8e9','#bae4b3','#74c476','#31a354','#006d2c'];

      return done(new ol.layer.Vector({
        source: new ol.source.Vector({ features }),
        style: f => new ol.style.Style({
          fill: new ol.style.Fill({ color: ramp[getBreakClass(f.get(fld), breaks)] }),
          stroke: new ol.style.Stroke({ color: '#555', width: 0.5 })
        })
      }));
    }

    if (mode === 'bivariate') {
      const yf = `Yield_${year}`;
      const yvals = features.map(f => f.get(yf)).filter(Number);
      const avals = features.map(f => {
        const area = f.get(`Area_${year}`);
        const total = f.get('Total_Area_Total_Area(ha)');
        return area && total ? area / total : null;
      }).filter(Number);

      const ybreaks = ss.jenks(yvals, 5);
      const abreaks = ss.jenks(avals, 5);

      const matrixColors = [
        ['#0d8040','#2c7d3d','#517938','#757530','#99712a'],
        ['#18a54a','#44a347','#71a141','#9D9B0B','#c9982c'],
        ['#50b95a','#76c049','#a3c63a','#d5c328','#f9c314'],
        ['#81c673','#a7d060','#d8e146','#ffe72e','#ffda04'],
        ['#d0e6c3','#dce8a4','#eaeb85','#f5ee69','#f7ed43']
      ];

      return done(new ol.layer.Vector({
        source: new ol.source.Vector({ features }),
        style: f => {
          const y = f.get(yf);
          const area = f.get(`Area_${year}`);
          const total = f.get('Total_Area_Total_Area(ha)');
          const a = area && total ? area / total : null;

          if (y == null || a == null || isNaN(y) || isNaN(a)) {
            return new ol.style.Style({
              fill: new ol.style.Fill({ color: '#ccc' }),
              stroke: new ol.style.Stroke({ color: '#444', width: 0.5 })
            });
          }

          const yi = Math.min(getBreakClass(y, ybreaks), 4);
          const ai = Math.min(getBreakClass(a, abreaks), 4);
          const color = matrixColors[yi][ai];

          return new ol.style.Style({
            fill: new ol.style.Fill({ color }),
            stroke: new ol.style.Stroke({ color: '#444', width: 0.5 })
          });
        }
      }));
    }

    if (mode === 'dotdensity') {
      const yieldField = `Yield_${year}`;
      const areaField = `Area_${year}`;

      const yieldVals = features.map(f => f.get(yieldField)).filter(Number);
      const yieldBreaks = ss.jenks(yieldVals, 10);
      const yieldColors = ['#f7fbff','#e3eef7','#d0e2ef','#bcd5e7','#a9c9df',
                          '#95bcd6','#82b0ce','#6ea3c6','#5b97be','#478ab6'];

      const bgLayer = new ol.layer.Vector({
        source: new ol.source.Vector({ features }),
        style: f => {
          const y = f.get(yieldField);
          const color = y != null ? yieldColors[getBreakClass(y, yieldBreaks)] : '#ccc';
          return new ol.style.Style({
            fill: new ol.style.Fill({ color }),
            stroke: new ol.style.Stroke({ color: '#555', width: 0.5 })
          });
        }
      });

      const symbolFeatures = features.map(f => {
        const geom = f.getGeometry();
        const area = f.get(areaField);

        if (geom && area && !isNaN(area)) {
          const centroid = ol.extent.getCenter(geom.getExtent());
          const radius = Math.sqrt(area) * 0.0035;

          const circle = new ol.Feature({ geometry: new ol.geom.Point(centroid) });
          circle.set('radius', radius);
          return circle;
        }
        return null;
      }).filter(Boolean);

      const circleLayer = new ol.layer.Vector({
        source: new ol.source.Vector({ features: symbolFeatures }),
        style: f => new ol.style.Style({
          image: new ol.style.Circle({
            radius: f.get('radius'),
            fill: new ol.style.Fill({ color: '#8b4513' }),
            stroke: new ol.style.Stroke({ color: '#333', width: 0.5 })
          })
        })
      });

      return done(new ol.layer.Group({ layers: [bgLayer, circleLayer] }));
    }

    return done(null);
  });
}

function updateMaps() {
  const mode = document.getElementById('mapMode').value;
  const yearA = document.getElementById('yearA').value;
  const yearB = document.getElementById('yearB').value;

  document.getElementById('yearLabelA').textContent = yearA;
  document.getElementById('yearLabelB').textContent = yearB;

  if (layerA) mapA.removeLayer(layerA);
  if (layerB) mapB.removeLayer(layerB);

  createLayerByMode(mode, yearA, ly => { if (ly) mapA.addLayer(layerA = ly); });
  createLayerByMode(mode, yearB, ly => { if (ly) mapB.addLayer(layerB = ly); });

  renderLegend(mode);
}

const tooltip = document.getElementById('tooltip');
function setupTooltip(map, id) {
  map.on('pointermove', evt => {
    const feat = map.forEachFeatureAtPixel(evt.pixel, f => f);
    if (feat) {
      const props = feat.getProperties();
      const year = document.getElementById(id === 'mapA' ? 'yearA' : 'yearB').value;
      const area = props['Area_' + year];
      const total = props['Total_Area_Total_Area(ha)'];
      const perc = area && total ? ((100 * area / total).toFixed(2) + '%') : '—';
      tooltip.style.left = evt.originalEvent.pageX + 10 + 'px';
      tooltip.style.top = evt.originalEvent.pageY + 10 + 'px';
      tooltip.innerHTML = `<strong>${props.Country || props.ADMIN || ''}</strong><br>
        Area: ${area ?? '—'}<br>
        Prod: ${props['Prod_' + year] ?? '—'}<br>
        Yield: ${props['Yield_' + year] ?? '—'}`;
      tooltip.style.display = 'block';
    } else tooltip.style.display = 'none';
  });
}
setupTooltip(mapA, 'mapA'); setupTooltip(mapB, 'mapB');

document.getElementById('mapMode').addEventListener('change', updateMaps);
document.getElementById('yearA').addEventListener('input', updateMaps);
document.getElementById('yearB').addEventListener('input', updateMaps);
updateMaps();

function renderLegend(mode) {
  const box = document.getElementById('legendBox');
  box.innerHTML = '';
  const year = document.getElementById('yearA').value;

  if (mode === 'yield') {
    const yf = `Yield_${year}`;
    fetch(geojsonUrl).then(r => r.json()).then(data => {
      const format = new ol.format.GeoJSON();
      const features = format.readFeatures(data, { featureProjection: 'EPSG:3857' });
      const vals = features.map(f => f.get(yf)).filter(Number);
      const breaks = ss.jenks(vals, 5);
      const ramp = ['#edf8e9','#bae4b3','#74c476','#31a354','#006d2c'];

      box.innerHTML = '<strong>Yield (tons/ha)</strong><br>';

box.innerHTML += '<div style="margin-top:6px;font-size:11px;">No data: <span style="display:inline-block;width:20px;height:20px;background:#ccc;border:1px solid #aaa;"></span></div>';

      for (let i = 0; i < breaks.length - 1; i++) {
        box.innerHTML += `<div style="margin:2px 0;">
          <span style="display:inline-block;width:20px;height:20px;background:${ramp[i]};border:1px solid #ccc;"></span>
          ${Math.round(breaks[i])}–${Math.round(breaks[i + 1])}</div>`;
      }
    });
  }

  if (mode === 'bivariate') {
    const yf = `Yield_${year}`;
    const af = `Area_${year}`;
    const tf = 'Total_Area_Total_Area(ha)';

    fetch(geojsonUrl).then(r => r.json()).then(data => {
      const format = new ol.format.GeoJSON();
      const features = format.readFeatures(data, { featureProjection: 'EPSG:3857' });

      const yvals = features.map(f => f.get(yf)).filter(Number);
      const avals = features.map(f => {
        const a = f.get(af), t = f.get(tf);
        return a && t ? a / t : null;
      }).filter(Number);

      const ybreaks = ss.jenks(yvals, 5);
      const abreaks = ss.jenks(avals, 5);

      const matrixColors = [
        ['#0d8040','#2c7d3d','#517938','#757530','#99712a'],
        ['#18a54a','#44a347','#71a141','#9D9B0B','#c9982c'],
        ['#50b95a','#76c049','#a3c63a','#d5c328','#f9c314'],
        ['#81c673','#a7d060','#d8e146','#ffe72e','#ffda04'],
        ['#d0e6c3','#dce8a4','#eaeb85','#f5ee69','#f7ed43']
      ];

      const grid = document.createElement('div');
      grid.style.display = 'inline-grid';
      grid.style.gridTemplateColumns = 'auto repeat(5, 24px)';
      grid.style.gridAutoRows = '24px';
      grid.style.gap = '1px';
      grid.style.fontSize = '10px';

      const title = document.createElement('div');
      title.innerHTML = '<strong>Yield (t/ha)</strong>';
      box.appendChild(title);

      for (let y = 0; y < 5; y++) {
        const label = document.createElement('div');
        label.style.textAlign = 'right';
        label.style.paddingRight = '6px';
        label.style.lineHeight = '24px';
        label.textContent = `${Math.round(ybreaks[y])}–${Math.round(ybreaks[y + 1])}`;
        grid.appendChild(label);

        for (let x = 0; x < 5; x++) {
          const cell = document.createElement('div');
          cell.style.width = '24px';
          cell.style.height = '24px';
          cell.style.background = matrixColors[y][x];
          cell.style.border = '1px solid #aaa';
          grid.appendChild(cell);
        }
      }
      box.appendChild(grid);
    });
  }

  if (mode === 'dotdensity') {
    const yf = `Yield_${year}`;
    const af = `Area_${year}`;

    fetch(geojsonUrl).then(r => r.json()).then(data => {
      const format = new ol.format.GeoJSON();
      const features = format.readFeatures(data, { featureProjection: 'EPSG:3857' });

      const yvals = features.map(f => f.get(yf)).filter(Number);
      const avals = features.map(f => f.get(af)).filter(Number);

      const ybreaks = ss.jenks(yvals, 10);
      const abreaks = ss.jenks(avals, 8);
      const yieldColors = ['#f7fbff','#e3eef7','#d0e2ef','#bcd5e7','#a9c9df',
                           '#95bcd6','#82b0ce','#6ea3c6','#5b97be','#478ab6'];

      
    box.innerHTML += '<strong>Dot Size: Area Harvested (ha)</strong><br>';
    for (let i = 1; i < abreaks.length; i++) {
      const r = Math.sqrt(abreaks[i]) * 0.0035;
      box.innerHTML += `<div style="margin:2px 0;">
        <span style="display:inline-block;width:${r * 2}px;height:${r * 2}px;border-radius:50%;background:#8b4513;border:1px solid #444;margin-right:5px;"></span>
        ${Math.round(abreaks[i - 1])}–${Math.round(abreaks[i])}</div>`;
    }
    box.innerHTML += '<div style="margin-top:10px;"><strong>Yield (t/ha)</strong><br>';
    
      for (let i = 0; i < ybreaks.length - 1; i++) {
        box.innerHTML += `<div style="margin:2px 0;">
          <span style="display:inline-block;width:20px;height:20px;background:${yieldColors[i]};border:1px solid #ccc;"></span>
          ${Math.round(ybreaks[i])}–${Math.round(ybreaks[i + 1])}</div>`;
      }

      
      for (let i = 1; i < abreaks.length; i++) {
        const r = Math.sqrt(abreaks[i]) * 0.0035;
        box.innerHTML += `<div style="margin:2px 0;">
          <span style="display:inline-block;width:${r * 2}px;height:${r * 2}px;border-radius:50%;background:#8b4513;border:1px solid #444;margin-right:5px;"></span>
          ${Math.round(abreaks[i - 1])}–${Math.round(abreaks[i])}</div>`;
      }
    });
  }
}