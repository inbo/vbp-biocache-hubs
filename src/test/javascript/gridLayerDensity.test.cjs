// Run with: node --test src/test/javascript/
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../../..');
const source = fs.readFileSync(path.join(root, 'grails-app/views/occurrence/_map.gsp'), 'utf8');

function templateSection(start, end) {
    const startIndex = source.indexOf(start);
    const endIndex = source.indexOf(end, startIndex);
    assert(startIndex >= 0 && endIndex > startIndex, 'Template section must exist: ' + start);
    return source.slice(startIndex, endIndex);
}

const MESSAGES = {
    loading: 'Loading grid...',
    zoom: 'Zoom in to display this grid resolution.',
    zoomOut: 'Zoom out to display this grid resolution.',
    empty: 'No records in this map view.',
    error: 'Unable to load grid data.',
    records: 'records per cell'
};

const DEFAULT_GRID_LAYER = {id: 'utm-grid-1000', facet: 'cl10531', wfsLayer: 'ALA:test', cellProperty: 'TAG', maxFeatures: 2500, minZoom: 0};

function gridResponse(counts, {gridLayer = DEFAULT_GRID_LAYER, zoom = 10} = {}) {
    const requests = [];
    let opacity = '0.8';
    let styles;
    let cleared = 0;
    const legends = [];
    const popups = [];
    const cellProperty = gridLayer.cellProperty || 'TAG';
    const features = counts.map((count, index) => ({properties: {[cellProperty]: 'cell-' + index}}));
    const jquery = selector => {
        const element = {
            attr: () => element,
            append: () => element,
            filter: () => element,
            first: () => element,
            text: value => {
                if (value !== undefined) return element;
                return selector === '#opacityslider-val' ? opacity : 'Grid layer';
            },
            0: {}
        };
        return element;
    };
    function deferred(promise, request) {
        return {
            then(fulfilled, rejected) { return deferred(promise.then(fulfilled, rejected)); },
            fail(callback) { promise.catch(callback); return this; },
            abort() { request.aborted = true; request.reject(new Error('abort')); }
        };
    }
    jquery.ajax = options => {
        const request = {options, aborted: false};
        const promise = new Promise((fulfilled, rejected) => { request.resolve = fulfilled; request.reject = rejected; });
        requests.push(request);
        return deferred(promise, request);
    };
    const cellBounds = {getWest: () => 2.9, getSouth: () => 49.9, getEast: () => 5.2, getNorth: () => 52.1};
    const context = {
        MAP_VAR: {
            gridLayerRequestId: 0,
            gridLayerXhr: null,
            gridLayerWfsUrl: 'https://example.org/geoserver/wfs',
            map: {
                getZoom: () => zoom,
                getBounds: () => ({getWest: () => 3, getSouth: () => 50, getEast: () => 5, getNorth: () => 52})
            },
            mappingUrl: 'https://example.org',
            query: '?q=*:*'
        },
        GRID_LAYER_MESSAGES: MESSAGES,
        L: {geoJson: () => ({getBounds: () => cellBounds})},
        URLSearchParams,
        window: {location: {pathname: '/occurrences/search', hash: ''}},
        $: jquery
    };
    vm.createContext(context);
    vm.runInContext(templateSection('    var GRID_LAYER_COLOURS', '    function addLegendItem('), context);
    context.setGridLayerLegend = message => legends.push(message);
    const layer = {
        clearLayers() { cleared++; },
        addData() {},
        setStyle(style) { styles = features.map(style); },
        eachLayer(callback) {
            features.forEach(feature => callback({feature, bindPopup(popup) { popups.push(feature); }}));
        }
    };
    const load = () => context.loadGridLayerDensity(layer, gridLayer);
    load();
    return {
        requests,
        context,
        legends,
        popups,
        load,
        get cleared() { return cleared; },
        async geometry(data = {type: 'FeatureCollection', features}, index = 0) {
            requests[index].resolve(data);
            await new Promise(setImmediate);
        },
        async complete(currentOpacity) {
            opacity = currentOpacity;
            await this.geometry();
            requests[1].resolve({facetResults: [{
                fieldName: gridLayer.facet,
                fieldResult: counts.map((count, index) => ({label: 'cell-' + index, count}))
            }]});
            await new Promise(setImmediate);
            return styles;
        }
    };
}

test('UTM layers use the factory provided by the bundled Leaflet version', () => {
    const leaflet = fs.readFileSync(path.join(root, 'grails-app/assets/vendor/leaflet/leaflet-src.js'), 'utf8');
    // Leaflet 0.7 defines L.geoJson directly; 1.9 minified exports it as an alias of geoJSON
    assert.match(leaflet, /L\.geoJson = function|\.geoJson=\w+/);
    assert.doesNotMatch(source, /L\.geoJSON\(/);
});

test('clicking a cell count filters that cell and preserves other filters and the map tab', () => {
    const context = {
        MAP_VAR: {query: '?q=speciesGroup:bird&fq=cl102:"Vlaams Gewest"&fq=cl10165:"old-cell"'},
        URLSearchParams,
        window: {location: {pathname: '/biocache-hub/occurrences/search', hash: '#tab_mapView'}}
    };
    vm.createContext(context);
    vm.runInContext(templateSection('    function buildGridCellFilterUrl(', '    function cancelGridLayerRequests('), context);

    const url = new URL(context.buildGridCellFilterUrl({facet: 'cl10165'}, 'FS1447'), 'https://example.org');
    assert.equal(url.pathname, '/biocache-hub/occurrences/search');
    assert.equal(url.hash, '#tab_mapView');
    assert.equal(url.searchParams.get('q'), 'speciesGroup:bird');
    assert.deepEqual(url.searchParams.getAll('fq'), ['cl102:"Vlaams Gewest"', 'cl10165:"FS1447"']);
});

const AUTO_DISPLAYS = {
    'auto-utm': {id: 'auto-utm', steps: [
        {layer: 'utm-grid-5000', maxZoom: 10},
        {layer: 'utm-grid-1000', maxZoom: 13},
        {layer: 'points', maxZoom: null}
    ]},
    'auto-ifbl': {id: 'auto-ifbl', steps: [
        {layer: 'ifbl-uur', maxZoom: 10},
        {layer: 'ifbl-kwartier', maxZoom: 12}
    ]}
};

const AUTO_GRID_LAYERS = {
    'utm-grid-5000': {id: 'utm-grid-5000', minZoom: 0, maxZoom: null},
    'utm-grid-1000': {id: 'utm-grid-1000', minZoom: 0, maxZoom: null},
    'ifbl-uur': {id: 'ifbl-uur', minZoom: 0, maxZoom: null},
    'ifbl-kwartier': {id: 'ifbl-kwartier', minZoom: 0, maxZoom: null}
};

function resolveMapDisplayContext(gridLayers = AUTO_GRID_LAYERS) {
    const context = {AUTO_DISPLAYS, GRID_LAYERS: gridLayers};
    vm.createContext(context);
    vm.runInContext(templateSection('    function resolveMapDisplay(', '    function gridLayerLabel('), context);
    return context;
}

test('an auto display resolves to the layer of the first step whose maxZoom covers the zoom level', () => {
    const {resolveMapDisplay} = resolveMapDisplayContext();
    assert.equal(resolveMapDisplay('auto-utm', 1), 'utm-grid-5000');
    assert.equal(resolveMapDisplay('auto-utm', 10), 'utm-grid-5000');
    assert.equal(resolveMapDisplay('auto-utm', 11), 'utm-grid-1000');
    assert.equal(resolveMapDisplay('auto-utm', 13), 'utm-grid-1000');
    assert.equal(resolveMapDisplay('auto-utm', 14), '', 'points step shows the default points');
    assert.equal(resolveMapDisplay('auto-utm', 20), '');
});

test('beyond the last step of an auto display its last step is used', () => {
    const {resolveMapDisplay} = resolveMapDisplayContext();
    assert.equal(resolveMapDisplay('auto-ifbl', 11), 'ifbl-kwartier');
    assert.equal(resolveMapDisplay('auto-ifbl', 18), 'ifbl-kwartier');
});

test('auto display steps whose grid layer is outside its own zoom range are skipped', () => {
    const {resolveMapDisplay} = resolveMapDisplayContext({
        ...AUTO_GRID_LAYERS,
        'utm-grid-5000': {id: 'utm-grid-5000', minZoom: 0, maxZoom: 8},
        'utm-grid-1000': {id: 'utm-grid-1000', minZoom: 12, maxZoom: null}
    });
    assert.equal(resolveMapDisplay('auto-utm', 8), 'utm-grid-5000');
    assert.equal(resolveMapDisplay('auto-utm', 9), '', 'neither grid layer shows zoom 9');
    assert.equal(resolveMapDisplay('auto-utm', 12), 'utm-grid-1000');
});

test('selections other than auto displays are returned unchanged', () => {
    const {resolveMapDisplay} = resolveMapDisplayContext();
    for (const selection of ['', 'grid', 'utm-grid-1000', 'basis_of_record']) {
        assert.equal(resolveMapDisplay(selection, 12), selection);
    }
});

function moveendHandlers({selection, zoom, activeDisplay, currentLayers}) {
    const handlers = {};
    const state = {selection, zoom, redraws: 0, refreshes: []};
    const MAP_VAR = {
        map: {on(event, handler) { handlers[event] = handler; }, getZoom: () => state.zoom},
        currentLayers,
        activeDisplay
    };
    const context = {
        MAP_VAR,
        AUTO_DISPLAYS,
        GRID_LAYERS: AUTO_GRID_LAYERS,
        $: () => ({val: () => state.selection}),
        loadGridLayerDensity(layer, gridLayer) { state.refreshes.push({layer, gridLayer}); },
        addQueryLayer(redraw, autoSwitch) {
            assert.equal(redraw, true);
            assert.equal(autoSwitch, true);
            state.redraws++;
            MAP_VAR.activeDisplay = context.resolveMapDisplay(state.selection, state.zoom);
        }
    };
    vm.createContext(context);
    vm.runInContext(templateSection('    function resolveMapDisplay(', '    function gridLayerLabel('), context);
    vm.runInContext(templateSection('        var popupAutoPan', '\n        addQueryLayer(true);\n'), context);
    return {handlers, state, MAP_VAR};
}

test('popup auto-pan keeps the grid, but subsequent ordinary movement refreshes it', () => {
    const hiddenGridLayer = {};
    for (const mode of ['utm-grid-1000', 'utm-grid-5000']) {
        const {handlers, state} = moveendHandlers({selection: mode, zoom: 12, activeDisplay: mode, currentLayers: [hiddenGridLayer]});
        handlers.autopanstart();
        handlers.moveend();
        assert.equal(state.refreshes.length, 0);
        handlers.moveend();
        assert.equal(state.refreshes.length, 1);
        assert.equal(state.refreshes[0].layer, hiddenGridLayer);
        assert.equal(state.redraws, 0, 'movement must not rebuild or re-add hidden layers');
    }
    const {handlers, state} = moveendHandlers({selection: 'grid', zoom: 12, activeDisplay: 'grid', currentLayers: [{}]});
    handlers.moveend();
    assert.equal(state.refreshes.length + state.redraws, 0);
});

test('an auto display redraws the occurrence layer only when the zoom crosses a step threshold', () => {
    const {handlers, state, MAP_VAR} = moveendHandlers({selection: 'auto-utm', zoom: 9, activeDisplay: 'utm-grid-5000', currentLayers: [{}]});
    handlers.moveend(); // pan within the 5 km step refreshes the cells
    assert.deepEqual([state.redraws, state.refreshes.length], [0, 1]);

    state.zoom = 11;
    handlers.moveend(); // 5 km -> 1 km
    assert.deepEqual([state.redraws, MAP_VAR.activeDisplay], [1, 'utm-grid-1000']);

    state.zoom = 14;
    handlers.moveend(); // 1 km -> points
    assert.deepEqual([state.redraws, MAP_VAR.activeDisplay], [2, '']);
    handlers.moveend(); // panning points does nothing
    assert.deepEqual([state.redraws, state.refreshes.length], [2, 1]);

    state.zoom = 8;
    handlers.moveend(); // points -> 5 km
    assert.deepEqual([state.redraws, MAP_VAR.activeDisplay], [3, 'utm-grid-5000']);
});

function queryLayerContext({selection, zoom = 9, currentLayers = []}) {
    const state = {mapLayers: new Set(currentLayers), controlLayers: [], pointControlsShown: null, densityLoads: 0};
    const overlay = {name: 'overlay', raised: 0, bringToFront() { this.raised++; }};
    const jquery = selector => ({
        val: () => selection,
        html: () => selector === '#sizeslider-val' ? '4' : selector === '#opacityslider-val' ? '0.6' : '',
        is: () => false,
        toggle(shown) { if (selector === '.pointLayerControl') state.pointControlsShown = shown; }
    });
    jquery.each = (items, callback) => items.forEach((item, index) => callback(index, item));
    jquery.ajax = () => {};
    const context = {
        MAP_VAR: {
            map: {
                getZoom: () => zoom,
                hasLayer: layer => state.mapLayers.has(layer),
                addLayer: layer => state.mapLayers.add(layer),
                removeLayer: layer => state.mapLayers.delete(layer)
            },
            layerControl: {addOverlay: layer => state.controlLayers.push(layer), removeLayer() {}},
            currentLayers: [...currentLayers],
            overlays: {overlay},
            query: '?q=*:*',
            additionalFqs: '',
            mappingUrl: 'https://example.org'
        },
        AUTO_DISPLAYS,
        GRID_LAYERS: AUTO_GRID_LAYERS,
        L: {geoJson: () => ({kind: 'grid'}), tileLayer: {wms: () => ({kind: 'points'})}},
        $: jquery,
        cancelGridLayerRequests() {},
        loadGridLayerDensity() { state.densityLoads++; },
        addDefaultLegendItem() {},
        addGridLegendItem() {}
    };
    vm.createContext(context);
    vm.runInContext(templateSection('    function resolveMapDisplay(', '    function gridLayerLabel('), context);
    vm.runInContext(templateSection('    function addQueryLayer(', '    function addDefaultLegendItem('), context);
    return {context, state, overlay};
}

test('size and outline controls are hidden while a grid layer is drawn', () => {
    assert.equal((source.match(/<td class="pointLayerControl">/g) || []).length, 2);
    for (const [selection, zoom, shown] of [['auto-utm', 9, false], ['auto-utm', 15, true], ['utm-grid-1000', 9, false], ['', 9, true], ['grid', 9, true]]) {
        const {context, state} = queryLayerContext({selection, zoom});
        context.addQueryLayer(true);
        assert.equal(state.pointControlsShown, shown, `${selection} at zoom ${zoom}`);
    }
});

test('an auto switch keeps a hidden occurrence layer hidden and leaves overlays alone', () => {
    const hiddenLayer = {kind: 'grid'};
    const {context, state, overlay} = queryLayerContext({selection: 'auto-utm', zoom: 15, currentLayers: [hiddenLayer]});
    state.mapLayers.delete(hiddenLayer);
    context.addQueryLayer(true, true);
    const [newLayer] = context.MAP_VAR.currentLayers;
    assert.equal(newLayer.kind, 'points');
    assert.equal(state.mapLayers.has(newLayer), false);
    assert.equal(state.mapLayers.has(overlay), false);
    assert.equal(overlay.raised, 0, 'a hidden overlay is not touched');
    assert.equal(state.controlLayers.at(-1), newLayer, 'the new layer is still offered in the layer control');
});

test('an auto switch of a visible occurrence layer shows the new layer', () => {
    const visibleLayer = {kind: 'points'};
    const {context, state} = queryLayerContext({selection: 'auto-utm', zoom: 9, currentLayers: [visibleLayer]});
    context.addQueryLayer(true, true);
    const [newLayer] = context.MAP_VAR.currentLayers;
    assert.equal(newLayer.kind, 'grid');
    assert.equal(state.mapLayers.has(newLayer), true);
    assert.equal(state.mapLayers.has(visibleLayer), false);
    assert.equal(state.densityLoads, 1);
    assert.equal(context.MAP_VAR.activeDisplay, 'utm-grid-5000');
});

test('an auto switch keeps a shown overlay above the new occurrence layer', () => {
    const {context, state, overlay} = queryLayerContext({selection: 'auto-utm', zoom: 9, currentLayers: [{kind: 'points'}]});
    state.mapLayers.add(overlay);
    context.addQueryLayer(true, true);
    assert.equal(overlay.raised, 1);
});

test('choosing a display re-adds the overlays as before', () => {
    const {context, state, overlay} = queryLayerContext({selection: ''});
    context.addQueryLayer(true);
    assert.equal(state.mapLayers.has(overlay), true);
    assert.equal(overlay.raised, 1);
});

test('the WFS request uses the configured URL, layer and feature limit', () => {
    const response = gridResponse([100]);
    const {url, data} = response.requests[0].options;
    assert.equal(url, 'https://example.org/geoserver/wfs');
    assert.equal(data.typeName, 'ALA:test');
    assert.equal(data.maxFeatures, 2501);
    assert.equal(response.legends[0], MESSAGES.loading);
});

test('cell codes are read from the configured cell property', async () => {
    const gridLayer = {...DEFAULT_GRID_LAYER, facet: 'cl999', cellProperty: 'CELLCODE'};
    const response = gridResponse([100, 200], {gridLayer});
    const styles = await response.complete('0.8');
    assert.equal(styles.length, 2);
    assert.equal(response.popups.length, 2);
    assert.equal(response.legends.at(-1), null);
});

test('below the configured minimum zoom no data is requested', () => {
    const response = gridResponse([100], {gridLayer: {...DEFAULT_GRID_LAYER, minZoom: 12}, zoom: 9});
    assert.equal(response.requests.length, 0);
    assert.equal(response.cleared, 1);
    assert.deepEqual(response.legends, [MESSAGES.zoom]);
});

test('above the configured maximum zoom no data is requested', () => {
    const response = gridResponse([100], {gridLayer: {...DEFAULT_GRID_LAYER, maxZoom: 14}, zoom: 15});
    assert.equal(response.requests.length, 0);
    assert.deepEqual(response.legends, [MESSAGES.zoomOut]);
});

test('without a maximum zoom, data is requested at any zoom level', () => {
    const response = gridResponse([100], {gridLayer: {...DEFAULT_GRID_LAYER, maxZoom: null}, zoom: 20});
    assert.equal(response.requests.length, 1);
});

test('legend class breaks cover the whole count range and match the cell colours', () => {
    const {context} = gridResponse([]);
    for (const scale of ['log', 'linear']) {
        for (const [min, max] of [[1, 1000], [3, 17], [1, 2], [250, 98765]]) {
            const classes = context.gridLayerClassBreaks(min, max, scale);
            assert.equal(classes[0].from, min);
            assert.equal(classes.at(-1).to, max);
            classes.forEach((gridClass, index) => {
                if (index > 0) assert.equal(gridClass.from, classes[index - 1].to + 1);
                const colourIndex = context.GRID_LAYER_COLOURS.indexOf(gridClass.colour);
                for (const count of [gridClass.from, gridClass.to]) {
                    assert.equal(context.gridLayerColourIndex(count, min, max, scale), colourIndex, `${scale} ${min}-${max} count ${count}`);
                }
            });
        }
    }
});

test('log scale legend breaks follow powers of ten for a 1 - 1,000,000 range', () => {
    const {context} = gridResponse([]);
    const classes = context.gridLayerClassBreaks(1, 1000000, 'log');
    assert.deepEqual(Array.from(classes, gridClass => gridClass.from), [1, 10, 100, 1000, 10000, 100000]);
});

test('equal minimum and maximum produce a single legend class', () => {
    const {context} = gridResponse([]);
    assert.deepEqual(JSON.parse(JSON.stringify(context.gridLayerClassBreaks(5, 5, 'log'))), [{colour: '#8c2d04', from: 5, to: 5}]);
});

test('a new load aborts the pending request and ignores its response', async () => {
    const response = gridResponse([100]);
    response.load();
    await new Promise(setImmediate);
    assert.equal(response.requests[0].aborted, true);
    assert.equal(response.requests.length, 2);
    assert(!response.legends.includes(MESSAGES.error));
});

test('response styling reads opacity changed while requests were pending', async () => {
    const styles = await gridResponse([100, 200]).complete('0.3');
    assert(styles.every(style => style.fillOpacity === 0.3));
});

test('minimum and maximum cell counts match the legend colour endpoints', async () => {
    const styles = await gridResponse([100, 150, 200]).complete('0.8');
    assert.equal(styles[0].fillColor, '#fff7bc');
    assert.equal(styles[1].fillColor, '#ec7014');
    assert.equal(styles[2].fillColor, '#8c2d04');
});

test('colours use a log scale so skewed counts still spread over the ramp', async () => {
    const styles = await gridResponse([1, 10, 100, 1000]).complete('0.8');
    assert.deepEqual(styles.map(style => style.fillColor), ['#fff7bc', '#fe9929', '#cc4c02', '#8c2d04']);
});

test('a linear scale spreads the colours evenly between the minimum and maximum count', async () => {
    const gridLayer = {...DEFAULT_GRID_LAYER, scale: 'linear'};
    const styles = await gridResponse([1, 10, 100, 1000], {gridLayer}).complete('0.8');
    assert.deepEqual(styles.map(style => style.fillColor), ['#fff7bc', '#fff7bc', '#fff7bc', '#8c2d04']);
});

test('equal cell counts produce a defined uniform colour', async () => {
    const styles = await gridResponse([100, 100]).complete('0.8');
    assert(styles.every(style => style.fillColor === '#8c2d04'));
});

test('a single populated cell produces a defined colour', async () => {
    const styles = await gridResponse([100]).complete('0.8');
    assert.equal(styles[0].fillColor, '#8c2d04');
});

test('count queries wait for geometry and cover the full bounds of edge cells', async () => {
    const response = gridResponse([100]);
    assert.equal(response.requests.length, 1);
    assert.equal(response.requests[0].options.data.request, 'GetFeature');
    await response.geometry();
    assert.equal(response.requests.length, 2);
    const query = new URL(response.requests[1].options.url).searchParams;
    assert.equal(query.get('facets'), 'cl10531');
    assert.deepEqual(query.getAll('fq'), [
        'decimalLatitude:[49.9 TO 52.1]',
        'decimalLongitude:[2.9 TO 5.2]'
    ]);
});

test('empty geometry clears previous cells without requesting counts', async () => {
    const response = gridResponse([]);
    await response.geometry();
    assert.equal(response.cleared, 1);
    assert.equal(response.requests.length, 1);
    assert.equal(response.legends.at(-1), MESSAGES.empty);
});

test('oversized geometry clears previous cells without requesting counts', async () => {
    const response = gridResponse([100]);
    await response.geometry({features: [{properties: {TAG: 'cell-0'}}], totalFeatures: 2501});
    assert.equal(response.cleared, 1);
    assert.equal(response.requests.length, 1);
    assert.equal(response.legends.at(-1), MESSAGES.zoom);
});

test('stale geometry does not start a count request or change the legend', async () => {
    const response = gridResponse([100]);
    response.context.MAP_VAR.gridLayerRequestId++;
    await response.geometry();
    assert.equal(response.requests.length, 1);
    assert.deepEqual(response.legends, [MESSAGES.loading]);
});

test('count request failures display the grid error', async () => {
    const response = gridResponse([100]);
    await response.geometry();
    response.requests[1].reject(new Error('Count service unavailable'));
    await new Promise(setImmediate);
    assert.equal(response.legends.at(-1), MESSAGES.error);
});
