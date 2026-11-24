<%@ page contentType="text/html;charset=UTF-8" %>
<asset:stylesheet src="map.css"/>
<g:set var="shortName" value="${grailsApplication.config.getProperty('skin.orgNameShort')}"/>
<%--
    Grid layers: polygon cells from a WFS layer, coloured by the record count per cell taken from a
    biocache facet whose values match a cell code attribute of the WFS layer. Configured as e.g.

    map:
      gridLayers:
        wfsUrl: https://example.org/geoserver/wfs   # defaults to /geoserver/wfs on the current host
        listLayers: true               # optional, false offers only the auto displays in the Display dropdown
        layers:
          - id: utm-grid-5000          # optional, value usable in map.defaultFacetMapColourBy, defaults to grid-<facet>
            facet: cl200               # required, label is taken from the facet.<facet> message
            wfsLayer: ALA:utm5         # required
            cellProperty: TAG          # optional, WFS attribute holding the cell code (default TAG)
            maxFeatures: 2500          # optional, more cells in view shows a 'zoom in' message (default 2500)
            minZoom: 0                 # optional, below this zoom level no data is requested (default 0)
            maxZoom: 18                # optional, above this zoom level no data is requested (default no limit)
            scale: log                 # optional, colour scale for the counts: log or linear (default log)
        auto:                          # optional display options that choose a layer based on the zoom level
          - id: auto-utm               # required, value usable in map.defaultFacetMapColourBy,
                                       # label is taken from the map.gridlayer.auto.<id> message (default: id)
            steps:                     # required, the first step whose maxZoom is >= the current zoom is shown,
                                       # skipping steps whose grid layer is outside its own minZoom / maxZoom
              - layer: utm-grid-5000   # required, a grid layer id or 'points'
                maxZoom: 10            # optional, omit for the last step (beyond the last step it is used too)
              - layer: utm-grid-1000
                maxZoom: 13
              - layer: points

    Grid cell colours, for all grid layers (default a yellow - brown ramp):

    map:
      gridLayers:
        colour: '#c04384'              # optional, a ramp from a light tint via this colour to a dark shade of it
        colours: ['#fff7bc', ...]      # optional, the colour classes from low to high counts, takes precedence

    The default opacity of the occurrence layer is set by map.defaultOpacity (default 0.6).
--%>
<g:set var="gridLayers" value="${(grailsApplication.config.getProperty('map.gridLayers.layers', List, []) ?: []).findAll { it?.facet && it?.wfsLayer }.collect { [
        id          : (it.id ?: "grid-${it.facet}").toString(),
        facet       : it.facet.toString(),
        wfsLayer    : it.wfsLayer.toString(),
        cellProperty: (it.cellProperty ?: 'TAG').toString(),
        maxFeatures : (it.maxFeatures ?: 2500) as Integer,
        minZoom     : (it.minZoom ?: 0) as Integer,
        maxZoom     : it.maxZoom ? it.maxZoom as Integer : null,
        scale       : it.scale?.toString()?.toLowerCase() == 'linear' ? 'linear' : 'log'
] }}"/>
<g:set var="autoDisplays" value="${(grailsApplication.config.getProperty('map.gridLayers.auto', List, []) ?: []).findAll { auto -> auto?.id && auto?.steps }.collect { auto -> [
        id   : auto.id.toString(),
        steps: (auto.steps as List).findAll { step -> step?.layer && (step.layer.toString() == 'points' || gridLayers.any { gridLayer -> gridLayer.id == step.layer.toString() }) }.collect { step -> [
                layer  : step.layer.toString(),
                maxZoom: step.maxZoom != null ? step.maxZoom as Integer : null
        ] }
] }.findAll { auto -> auto.steps }}"/>
<g:set var="gridLayerLabels" value="${gridLayers.collectEntries { [(it.id): alatag.formatDynamicFacetName(fieldName: it.facet).toString()] }}"/>
<g:set var="listGridLayers" value="${grailsApplication.config.getProperty('map.gridLayers.listLayers', Boolean, true)}"/>
<g:set var="gridLayerColourConfig" value="${[
        colour : grailsApplication.config.getProperty('map.gridLayers.colour', String, ''),
        colours: (grailsApplication.config.getProperty('map.gridLayers.colours', List, []) ?: []).collect { it.toString() }
]}"/>
<g:set var="defaultOpacity" value="${grailsApplication.config.getProperty('map.defaultOpacity', String, '0.6')}"/>
<div style="margin-bottom: 10px">
    <g:if test="${grailsApplication.config.getProperty('skin.useAlaSpatialPortal', Boolean, false)}">
        <g:set var='spatialPortalLink' value="${sr.urlParameters}"/>
        <g:set var='spatialPortalUrlParams' value="${grailsApplication.config.getProperty('spatial.params')}"/>
        <g:set var='spatialEnableQualityWarning' value="${grailsApplication.config.getProperty('spatial.enableQualityWarning', Boolean, false)}" />
        <g:if test="${!spatialEnableQualityWarning || searchRequestParams.disableAllQualityFilters || qualityFiltersByLabel.isEmpty()}">
            <a id="spatialPortalLink" class="btn btn-default btn-sm tooltips"
               href="${grailsApplication.config.getProperty('spatial.baseUrl')}${spatialPortalLink}${spatialPortalUrlParams}" title="<g:message code="map.spatialportal.btn.title.param" args="${[shortName]}"/>">
                <i class="fa fa-map-marker"></i>&nbsp;&nbsp;<g:message code="map.spatialportal.btn.label" default="View in spatial portal"/></a>
        </g:if>
        <g:else>
            <a href="#gotoSpatial" role="button" data-toggle="modal" class="btn btn-default btn-sm tooltips" title="<g:message code="map.spatialportal.btn.title.param" args="${[shortName]}"/>">
                <i class="fa fa-map-marker"></i>&nbsp;&nbsp;<g:message code="map.spatialportal.btn.label" default="View in spatial portal"/></a>
        </g:else>
    </g:if>
    <a href="#downloadMap" role="button" data-toggle="modal" class="btn btn-default btn-sm tooltips" title="<g:message code="map.downloadmaps.btn.title"/>">
        <i class="fa fa-download"></i>&nbsp;&nbsp;<g:message code="map.downloadmaps.btn.label" default="Download map"/></a>
    <g:if test="${params.wkt}">
        <a href="#downloadWKT" role="button" class="btn btn-default btn-sm tooltips" title="<g:message code="map.downloadwkt.btn.title"/>" onclick="downloadPolygon(); return false;">
            <i class="glyphicon glyphicon-stop"></i>&nbsp;&nbsp;<g:message code="map.downloadwkt.btn.label" default="Download WKT"/></a>
    </g:if>
    <%-- <div id="spatialSearchFromMap" class="btn btn-default btn-small">
        <a href="#" id="wktFromMapBounds" class="tooltips" title="Restrict search to current view">
            <i class="hide glyphicon glyphicon-share-alt"></i> Restrict search</a>
    </div>
    TODO - Needs hook in UI to detect a wkt param and include button/link under search query and selected facets.
    TODO - Also needs to check if wkt is already specified and remove previous wkt param from query.
    --%>
</div>

<div class="collapse" id="recordLayerControls">
    <table id="mapLayerControls">
        <tr>
            <td>
                <label for="colourBySelect"><g:message code="map.maplayercontrols.tr01td01.label" default="Colour by"/>:&nbsp;</label>
                <div class="layerControls">
                    <select name="colourBySelect" id="colourBySelect" onchange="changeFacetColours();return true;">
                        <option value=""><g:message code="map.maplayercontrols.tr01td01.option01" default="Points - default colour"/></option>
                        <option value="grid" ${(defaultColourBy == 'grid')?'selected=\"selected\"':''}><g:message code="map.maplayercontrols.tr01td01.option02" default="Record density grid"/></option>
                        <g:each var="autoDisplay" in="${autoDisplays}">
                            <option value="${autoDisplay.id}" ${(defaultColourBy == autoDisplay.id)?'selected=\"selected\"':''}><g:message code="map.gridlayer.auto.${autoDisplay.id}" default="${autoDisplay.id}"/></option>
                        </g:each>
                        <g:if test="${listGridLayers}">
                            <g:each var="gridLayer" in="${gridLayers}">
                                <option value="${gridLayer.id}" ${(defaultColourBy == gridLayer.id)?'selected=\"selected\"':''}>${gridLayerLabels[gridLayer.id]}</option>
                            </g:each>
                        </g:if>
                        <option disabled role="separator">————————————</option>
                        <g:each var="group" in="${groupedFacetsRequested}">
                            <g:each var="fieldName" in="${group.value}">
                                <g:if test="${fieldName}">
                                    <g:set var="Defaultselected">
                                        <g:if test="${defaultColourBy && fieldName == defaultColourBy}">selected="selected"</g:if>
                                    </g:set>
                                    <g:if test="${fieldName == 'occurrence_year'}">${fieldName = 'decade'}</g:if>
                                    <g:if test="${fieldName == 'uncertainty'}">${fieldName = 'coordinate_uncertainty'}</g:if>
                                    <option value="${fieldName}" ${Defaultselected}>
                                        <alatag:formatDynamicFacetName fieldName="${fieldName}"/>
                                    </option>
                                </g:if>
                            </g:each>
                        </g:each>
                    </select>
                </div>
            </td>
            <td class="pointLayerControl">
                <label for="sizeslider"><g:message code="map.maplayercontrols.tr01td02.label" default="Size"/>:</label>
                <div class="layerControls">
                    <span class="slider-val" id="sizeslider-val">4</span>
                </div>
                <div id="sizeslider" style="width:75px;"></div>
            </td>
            <td>
                <label for="opacityslider"><g:message code="map.maplayercontrols.tr01td03.label" default="Opacity"/>:</label>
                <div class="layerControls">
                    <span class="slider-val" id="opacityslider-val">${defaultOpacity}</span>
                </div>
                <div id="opacityslider" style="width:75px;"></div>
            </td>
            <td class="pointLayerControl">
                <label for="outlineDots"><g:message code="map.maplayercontrols.tr01td04.label" default="Outline"/>:</label>
                <input type="checkbox" name="outlineDots" ${grailsApplication.config.getProperty('map.outlineDots') ? 'checked="checked"' : ''} value="true" class="layerControls" id="outlineDots">
            </td>
        </tr>
    </table>
</div>

<div id="leafletMap" class="col-md-12" style="height:600px;"></div>

<div id="template" style="display:none">
    <div class="colourbyTemplate">
        <a class="colour-by-legend-toggle colour-by-control tooltips" href="#" title="<g:message code="map.legend.click.to.expand" default="Map legend - click to expand"/>"><i class="fa fa-list-ul fa-lg"></i></a>
        <form class="leaflet-control-layers-list">
            <div class="leaflet-control-layers-overlays">
                <div style="overflow:auto; max-height:400px;">
                    <button type="button" class="close hideColourControl" style="padding-left:7px;opacity:0.5;">&times;</button>
                    <table class="legendTable"></table>
                </div>
            </div>
        </form>
    </div>
</div>


<div id="recordPopup" style="display:none;">
    <a href="#"><g:message code="map.recordpopup" default="View records at this point"/></a>
</div>

<alatag:hubDecoder/> <!-- injects window.__hubDecode -->
<g:set var="defaultMapVectorTileUrl" value="${grailsApplication.config.getProperty('map.minimal.vectorTileUrl', String) ?: grailsApplication.config.getProperty('map.minimal.styleUrl', String) ?: ''}"/>
<g:set var="defaultMapUrl" value="${grailsApplication.config.getProperty('map.minimal.url', String) ?: ''}"/>
<%
    if (defaultMapVectorTileUrl && !defaultMapVectorTileUrl.contains('key=')) {
        def apiKey = grailsApplication.config.getProperty('map.minimal.apiKey', String)
        if (!apiKey && defaultMapUrl) {
            def matcher = (defaultMapUrl =~ /[?&]key=([^&#]+)/)
            if (matcher.find()) {
                apiKey = matcher.group(1)
            }
        }
        if (apiKey) {
            defaultMapVectorTileUrl += (defaultMapVectorTileUrl.contains('?') ? '&' : '?') + "key=${apiKey}"
        }
    }
%>
<asset:script type="text/javascript">
    var leaflet = (window.L && window.L.maplibreGL) ? window.L : (window.L_mainMap || window.L);
    if (leaflet.Google) {
        leaflet.Google.apiKey = "${grailsApplication.config.getProperty('google.apikey', String, '')}";
    }
    var defaultBaseLayer;
    if ("${defaultMapVectorTileUrl}" && typeof leaflet.maplibreGL === 'function') {
        try {
            var vectorOptions = {
                style: "${defaultMapVectorTileUrl}",
                pane: 'tilePane',
                zIndex: 0
            };
            var attr = "${raw(grailsApplication.config.getProperty('map.minimal.attr'))}";
            if (attr) {
                vectorOptions.attributionControl = { customAttribution: attr };
            }
            defaultBaseLayer = leaflet.maplibreGL(vectorOptions);
        } catch (e) {
            console.warn("Failed to initialize MapLibre GL layer, falling back to raster tiles:", e);
        }
    }
    if (!defaultBaseLayer) {
        defaultBaseLayer = leaflet.tileLayer("${defaultMapUrl}", {
            attribution: "${raw(grailsApplication.config.getProperty('map.minimal.attr'))}",
            subdomains: "${grailsApplication.config.getProperty('map.minimal.subdomains')}",
            mapid: "${grailsApplication.config.getProperty('map.mapbox.id', String, '')}",
            token: "${grailsApplication.config.getProperty('map.mapbox.token', String, '')}"
        });
    }

    // keyed by grid layer id, see the gridLayers comment at the top of this template
    var GRID_LAYERS = ${raw(groovy.json.JsonOutput.toJson(gridLayers.collectEntries { [(it.id): it] }).replace('</', '<\\/'))};

    // grid layer labels keyed by grid layer id, also for grid layers only used by auto displays
    var GRID_LAYER_LABELS = ${raw(groovy.json.JsonOutput.toJson(gridLayerLabels).replace('</', '<\\/'))};

    // keyed by auto display id, see the gridLayers comment at the top of this template
    var AUTO_DISPLAYS = ${raw(groovy.json.JsonOutput.toJson(autoDisplays.collectEntries { [(it.id): it] }).replace('</', '<\\/'))};

    // map.gridLayers.colour / colours, see the comment at the top of this template
    var GRID_LAYER_COLOUR_CONFIG = ${raw(groovy.json.JsonOutput.toJson(gridLayerColourConfig).replace('</', '<\\/'))};

    var GRID_LAYER_MESSAGES = {
        loading: '<g:message code="map.gridlayer.loading" default="Loading grid..." encodeAs="JavaScript"/>',
        zoom: '<g:message code="map.gridlayer.zoom" default="Zoom in to display this grid resolution." encodeAs="JavaScript"/>',
        zoomOut: '<g:message code="map.gridlayer.zoomout" default="Zoom out to display this grid resolution." encodeAs="JavaScript"/>',
        scaleLog: '<g:message code="map.gridlayer.scale.log" default="log scale" encodeAs="JavaScript"/>',
        scaleLinear: '<g:message code="map.gridlayer.scale.linear" default="linear scale" encodeAs="JavaScript"/>',
        empty: '<g:message code="map.gridlayer.empty" default="No records in this map view." encodeAs="JavaScript"/>',
        error: '<g:message code="map.gridlayer.error" default="Unable to load grid data." encodeAs="JavaScript"/>',
        records: '<g:message code="map.gridlayer.records" default="records per cell" encodeAs="JavaScript"/>'
    };

    var MAP_VAR = {
        googleApiKey : "${grailsApplication.config.getProperty('google.apikey', String, '')}",
        map : null,
        mappingUrl : "${mappingUrl}", // e.g. "https://biocache.ala.org.au/ws"
        gridLayerWfsUrl : "${grailsApplication.config.getProperty('map.gridLayers.wfsUrl', String, '').encodeAsJs()}" ||
            window.location.protocol + "//" + window.location.host + "/geoserver/wfs",
        query : window.__hubDecode("<alatag:b64 value="${searchString}"/>"), // e.g. "?q=*%3A*&lat=-34.266296&lon=145.3838&radius=154.8"
        queryDisplayString : window.__hubDecode("<alatag:b64 value="${queryDisplayString}"/>"), // e.g. "[all records] - within 154.8 km of point(-34.266, 145.384)"
        center: [-23.6,133.6],
        defaultLatitude : "${grailsApplication.config.getProperty('map.defaultLatitude', String, '-23.6')}",
        defaultLongitude : "${grailsApplication.config.getProperty('map.defaultLongitude', String, '133.6')}",
        defaultZoom : "${grailsApplication.config.getProperty('map.defaultZoom', String, '4')}",
        overlays : {
            <g:if test="${grailsApplication.config.getProperty("map.overlay.url") && overlayList}">
                <g:each in="${overlayList}" var="layer">
                    "${layer.layerDisplayName?.encodeAsJs()?:'overlay'}" : L.tileLayer.wms("${grailsApplication.config.getProperty("map.overlay.url")}", {
                    layers: 'ALA:${layer.layerName}',
                    format: 'image/png',
                    transparent: true,
                    opacity: ${grailsApplication.config.getProperty("map.overlay.opacity","0.5")},
                    attribution: "${layer.source}",
                    zIndex: 5
                }),
                </g:each>
            </g:if>

        },
        baseLayers : {
            "Minimal" : defaultBaseLayer,
            "Road" :  new L.Google('ROADMAP'),
            "Terrain" : new L.Google('TERRAIN'),
            "Satellite" : new L.Google('HYBRID')
        },
        layerControl : null,
        currentLayers : [],
        activeDisplay : null, // the display drawn by addQueryLayer, an auto display resolved for the zoom level
        gridLayerRequestId : 0,
        gridLayerXhr : null,
        additionalFqs : '',
        zoomOutsideScopedRegion: ${(grailsApplication.config.getProperty('map.zoomOutsideScopedRegion', Boolean) == false || grailsApplication.config.getProperty('map.zoomOutsideScopedRegion') == "false") ? false : true},
        removeFqs: ''
    };

    var ColourByControl = L.Control.extend({
        options: {
            position: 'topright',
            collapsed: false
        },
        onAdd: function (map) {
            // create the control container with a particular class name
            var $controlToAdd = $('.colourbyTemplate').clone();
            var container = L.DomUtil.create('div', 'leaflet-control-layers');
            var $container = $(container);
            $container.attr("id","colourByControl");
            $container.attr('aria-haspopup', true);
            $container.html($controlToAdd.html());
            return container;
        }
    });

    var RecordLayerControl = L.Control.extend({
        options: {
            position: 'topright',
            collapsed: false
        },
        onAdd: function (map) {
            // create the control container with a particular class name
            var container = L.DomUtil.create('div', 'leaflet-control-layers');
            var $container = $(container);
            $container.attr("id","recordLayerControl");
            $('#mapLayerControls').prependTo($container);
            // Fix for Firefox select bug
            var stop = L.DomEvent.stopPropagation;
            L.DomEvent
                .on(container, 'click', stop)
                .on(container, 'mousedown', stop);
            return container;
        }
    });

    function initialiseMap(){
        //console.log("initialiseMap", MAP_VAR.map);
        if(MAP_VAR.map != null){
            return;
        }

        //initialise map
        MAP_VAR.map = L.map('leafletMap', {
            center: [MAP_VAR.defaultLatitude, MAP_VAR.defaultLongitude],
            zoom: MAP_VAR.defaultZoom,
            minZoom: 1,
            scrollWheelZoom: ${(grailsApplication.config.getProperty('map.scrollWheelZoom', Boolean) == true || grailsApplication.config.getProperty('map.scrollWheelZoom') == "true") ? true : false},
            fullscreenControl: true,
            fullscreenControlOptions: {
                position: 'topleft'
            },
            worldCopyJump: true
        });

        //add edit drawing toolbar
        // Initialise the FeatureGroup to store editable layers
        MAP_VAR.drawnItems = new L.FeatureGroup();
        MAP_VAR.map.addLayer(MAP_VAR.drawnItems);

        // Initialise the draw control and pass it the FeatureGroup of editable layers
        MAP_VAR.drawControl = new L.Control.Draw({
            edit: {
                featureGroup: MAP_VAR.drawnItems
            },
            draw: {
                polyline: false,
                rectangle: {
                    shapeOptions: {
                        color: '#bada55'
                    }
                },
                circle: {
                    shapeOptions: {
                        color: '#bada55'
                    }
                },
                marker: false,
                polygon: {
                    allowIntersection: false, // Restricts shapes to simple polygons
                    drawError: {
                        color: '#e1e100', // Color the shape will turn when intersects
                        message: '<strong><g:message code="advancedsearch.js.map.error1"/></strong> <g:message code="advancedsearch.js.map.error2"/>' // Message that will show when intersect
                    },
                    shapeOptions: {
                        color: '#bada55'
                    }
                }
            }
        });
        MAP_VAR.map.addControl(MAP_VAR.drawControl);

        MAP_VAR.map.on('draw:created', function(e) {
            //setup onclick event for this object
            var layer = e.layer;
            MAP_VAR.drawnItems.addLayer(layer);
            generatePopup(layer, layer._latlng);
            addClickEventForVector(layer);
        });

        L.control.coordinates({position:"bottomright", useLatLngOrder: true}).addTo(MAP_VAR.map); // coordinate plugin

        MAP_VAR.layerControl = L.control.layers(MAP_VAR.baseLayers, MAP_VAR.overlays, {collapsed:true, position:'topleft'});
        MAP_VAR.layerControl.addTo(MAP_VAR.map);
        var popupAutoPan = false;
        MAP_VAR.map.on('autopanstart', function() {
            popupAutoPan = true;
        });
        MAP_VAR.map.on('moveend', function() {
            if (popupAutoPan) {
                popupAutoPan = false;
                return;
            }
            var display = resolveMapDisplay($('#colourBySelect').val(), MAP_VAR.map.getZoom());
            if (display !== MAP_VAR.activeDisplay) {
                // an auto display crossed a zoom threshold
                addQueryLayer(true, true);
                return;
            }
            var gridLayer = GRID_LAYERS[display];
            if (gridLayer && MAP_VAR.currentLayers.length === 1) {
                loadGridLayerDensity(MAP_VAR.currentLayers[0], gridLayer);
            }
        });

        addQueryLayer(true);

        MAP_VAR.map.addControl(new RecordLayerControl());
        MAP_VAR.map.addControl(new ColourByControl());

        L.Util.requestAnimFrame(MAP_VAR.map.invalidateSize, MAP_VAR.map, !1, MAP_VAR.map._container);
        // L.Browser.any3d is no longer forced to false (a Leaflet 0.7 Firefox select workaround): with Leaflet 1.9 it
        // positions popups with left/top, which the popup offset overwrites, so they appear at the left edge of the map

        MAP_VAR.map.on('baselayerchange', function(event) {
            $.cookie('map.baseLayer', event.name, { path: '/' });
            if (event.layer && typeof event.layer.bringToBack === 'function') {
                event.layer.bringToBack();
            }
            if (event.name === 'Minimal' && event.layer === defaultBaseLayer && typeof defaultBaseLayer.getMaplibreMap === 'function') {
                var glMap = defaultBaseLayer.getMaplibreMap();
                if (glMap) {
                    glMap.once('error', handleVectorFallback);
                }
            }
            $.each(MAP_VAR.currentLayers, function(index, value){
                if (typeof value.bringToFront === 'function') {
                    value.bringToFront();
                }
            });
        });

        function handleVectorFallback(err) {
            console.warn("MapLibre GL error encountered, falling back to raster tiles:", err);
            var wasActive = MAP_VAR.map && MAP_VAR.map.hasLayer(defaultBaseLayer);
            if (wasActive) {
                MAP_VAR.map.removeLayer(defaultBaseLayer);
            }
            var fallbackLayer = leaflet.tileLayer("${defaultMapUrl}", {
                attribution: "${raw(grailsApplication.config.getProperty('map.minimal.attr'))}",
                subdomains: "${grailsApplication.config.getProperty('map.minimal.subdomains')}",
                mapid: "${grailsApplication.config.getProperty('map.mapbox.id', String, '')}",
                token: "${grailsApplication.config.getProperty('map.mapbox.token', String, '')}"
            });
            if (wasActive) {
                fallbackLayer.addTo(MAP_VAR.map);
                if (typeof fallbackLayer.bringToBack === 'function') {
                    fallbackLayer.bringToBack();
                }
            }
            MAP_VAR.baseLayers["Minimal"] = fallbackLayer;
            if (MAP_VAR.layerControl) {
                MAP_VAR.layerControl.removeLayer(defaultBaseLayer);
                MAP_VAR.layerControl.addBaseLayer(fallbackLayer, "Minimal");
            }
        }

        if (typeof defaultBaseLayer.once === 'function') {
            defaultBaseLayer.once('error', handleVectorFallback);
        }

        // select the user's preferred base layer
        var userBaseLayer = $.cookie('map.baseLayer')
        var baseLayer = MAP_VAR.baseLayers[userBaseLayer]
        if (baseLayer !== undefined) {
            //add the default base layer
            MAP_VAR.map.addLayer(baseLayer);
            if (typeof baseLayer.bringToBack === 'function') {
                baseLayer.bringToBack();
            }
        } else {
            MAP_VAR.map.addLayer(defaultBaseLayer);
            if (typeof defaultBaseLayer.bringToBack === 'function') {
                defaultBaseLayer.bringToBack();
            }
        }

        if (typeof defaultBaseLayer.getMaplibreMap === 'function') {
            var glMap = defaultBaseLayer.getMaplibreMap();
            if (glMap) {
                glMap.once('error', handleVectorFallback);
            }
        }

        $('.colour-by-control').click(function(e){

            if($(this).parent().hasClass('leaflet-control-layers-expanded')){
                $(this).parent().removeClass('leaflet-control-layers-expanded');
                $('.colour-by-legend-toggle').show();
            } else {
                $(this).parent().addClass('leaflet-control-layers-expanded');
                $('.colour-by-legend-toggle').hide();
            }
            e.preventDefault();
            e.stopPropagation();
            return false;
        });
        $('.hideColourControl').click(function(e){
            //console.log('hideColourControl');
            $('#colourByControl').removeClass('leaflet-control-layers-expanded');
            $('.colour-by-legend-toggle').show();
            e.preventDefault();
            e.stopPropagation();
            return false;
        });

        $( "#sizeslider" ).slider({
            min:1,
            max:6,
            value: Number($('#sizeslider-val').text()),
            tooltip: 'hide'
        }).on('slideStop', function(ev){
            $('#sizeslider-val').html(ev.value);
            if (!GRID_LAYERS[MAP_VAR.activeDisplay]) { // point size has no effect on grid layers
                addQueryLayer(true);
            }
        });

        $( "#opacityslider" ).slider({
            min: 0.1,
            max: 1.0,
            step: 0.1,
            value: Number($('#opacityslider-val').text()),
            tooltip: 'hide'
        }).on('slideStop', function(ev){
            var value = parseFloat(ev.value).toFixed(1); // prevent values like 0.30000000004 appearing
            $('#opacityslider-val').html(value);
            if (MAP_VAR.currentLayers.length == 1) {
                var currentLayer = MAP_VAR.currentLayers[0];
                if (currentLayer.setOpacity) {
                    currentLayer.setOpacity(value);
                } else if (currentLayer.setStyle) {
                    currentLayer.setStyle({fillOpacity: parseFloat(value)});
                }
            } else {
                addQueryLayer(true);
            }
        });

        $('#outlineDots').click(function(e) {
            if (!GRID_LAYERS[MAP_VAR.activeDisplay]) { // outline has no effect on grid layers
                addQueryLayer(true);
            }
        });

        fitMapToBounds(); // zoom map if points are contained within Australia
        //drawCircleRadius(); // draw circle around lat/lon/radius searches

        // display vector from previous wkt search
        var wktFromParams = "${params.wkt}";
        // duplicate wkt and circle for leaflet's continous world display.
        var obj = undefined;
        var objLeft = undefined;
        var objRight = undefined;
        if (wktFromParams) {
            // draw WKT feature
            var wkt = new Wkt.Wkt();
            wkt.read(wktFromParams);
            obj = wkt.toObject({color: '#bada55' });
            objLeft = wkt.toObject({color: '#bada55', translate: {x: -360} });
            objRight = wkt.toObject({color: '#bada55', translate: {x: 360} });
        } else if (isSpatialRadiusSearch()) {
            // draw circle onto map
            obj = L.circle([getUrlParam('lat'), getUrlParam('lon')], (getUrlParam('radius') * 1000), {color: '#bada55'});
            // following lines were causing error in leaflet, so removed them. NdR Jan 2018.
            // objLeft  = L.circle([getUrlParam('lat'), getUrlParam('lon')] - 360, (getUrlParam('radius') * 1000), {color: '#bada55'});
            // objRight = L.circle([getUrlParam('lat'), getUrlParam('lon')] + 360, (getUrlParam('radius') * 1000), {color: '#bada55'});
        }
        if (obj) {
            MAP_VAR.map.addHandler('paramArea', L.PointClickHandler.extend({obj: obj}));
            MAP_VAR.map.paramArea.enable();
            MAP_VAR.drawnItems.addLayer(obj);
        }
        if (objLeft) {
            MAP_VAR.map.addHandler('paramAreaLeft', L.PointClickHandler.extend({obj: objLeft}));
            MAP_VAR.map.paramAreaLeft.enable();
            MAP_VAR.drawnItems.addLayer(objLeft);
        }
        if (objRight) {
            MAP_VAR.map.addHandler('paramAreaRight', L.PointClickHandler.extend({obj: objRight}));
            MAP_VAR.map.paramAreaRight.enable();
            MAP_VAR.drawnItems.addLayer(objRight);
        }

        MAP_VAR.map.on('draw:edited', function(e) {
            //setup onclick event for this object
            var layers = e.layers;
            layers.eachLayer(function (layer) {
                generatePopup(layer, layer._latlng);
                addClickEventForVector(layer);
            });
        });

        MAP_VAR.recordList = new Array(); // store list of records for popup

        //MAP_VAR.map.on('click', pointLookupClickRegister);
        if (obj === undefined) {
            MAP_VAR.map.addHandler('paramArea', L.PointClickHandler.extend({obj: MAP_VAR.map}));
            MAP_VAR.map.paramArea.enable();
        }

        // Add a help tooltip to map when first loaded
        MAP_VAR.map.whenReady(function() {
            var opts = {
                placement:'right',
                callback: destroyHelpTooltip // hide help tooltip when mouse over the tools
            }
            $('.leaflet-draw-toolbar a').tooltip(opts);
            //$('.leaflet-draw-toolbar').first().attr('title',jQuery.i18n.prop('advancedsearch.js.choosetool')).tooltip({placement:'right'}).tooltip('show');
        });

        // Hide help tooltip on first click event
        var once = true;
        MAP_VAR.map.on('click', function(e) {
            if (once) {
                $('.leaflet-draw-toolbar').tooltip('destroy');
                once = false;
            }
        });
    }

    // helper to remove tooltips from map
    var once = true;
    function destroyHelpTooltip() {
        if ($('.leaflet-draw-toolbar').length && once) {
            $('.leaflet-draw-toolbar').tooltip('destroy');
            once = false;
        }
    }

    function changeFacetColours() {
        MAP_VAR.additionalFqs = '';
        // clear this variable every time a new colour by is chosen.
        MAP_VAR.removeFqs = ''
        //e.preventDefault();
        //e.stopPropagation();
        addQueryLayer(true);
        return true;
    }

    function showHideControls(el) {
        //console.log("el", el, this);
        var $this = this;
        if ($($this).hasClass('fa')) {
            alert("activating");
            $($this).hide();
            $($this + ' table.controls').show();
        } else {
            alert("deactivating");
            $($this).show();
            $($this + ' table.controls').hide();
        }
    }

    /**
     * A tile layer to map colouring the dots by the selected colour.
     * autoSwitch: redrawn because an auto display changed layer while zooming, which keeps the layer control state
     * (a hidden occurrence layer stays hidden and overlays are left as they are).
     */
    function addQueryLayer(redraw, autoSwitch){

        var keepHidden = autoSwitch && MAP_VAR.currentLayers.length === 1 && !MAP_VAR.map.hasLayer(MAP_VAR.currentLayers[0]);

        $.each(MAP_VAR.currentLayers, function(index, value){
            MAP_VAR.map.removeLayer(MAP_VAR.currentLayers[index]);
            MAP_VAR.layerControl.removeLayer(MAP_VAR.currentLayers[index]);
        });

        MAP_VAR.currentLayers = [];

        var colourByFacet = resolveMapDisplay($('#colourBySelect').val(), MAP_VAR.map.getZoom());
        var gridLayer = GRID_LAYERS[colourByFacet];
        MAP_VAR.activeDisplay = colourByFacet;
        // size and outline only apply to drawn points and the record density grid
        $('.pointLayerControl').toggle(!gridLayer);
        var pointSize = $('#sizeslider-val').html();
        var opacity = $('#opacityslider-val').html();
        var outlineDots = $('#outlineDots').is(':checked');

        if (!gridLayer) {
            cancelGridLayerRequests();
        }

        // opacity is applied by the tile layer only, as for coloured facets (in ENV as well it would be applied twice)
        var envProperty = "color:${grailsApplication.config.getProperty('map.pointColour')};name:circle;size:"+pointSize+";opacity:1"

        if(colourByFacet){
            if(colourByFacet == "gridVariable"){
                colourByFacet = "coordinate_uncertainty"
                envProperty = "colormode:coordinate_uncertainty;name:circle;size:"+pointSize+";opacity:1;cellfill:0xffccff;variablegrids:on"
            } else {
                envProperty = "colormode:" + colourByFacet + ";name:circle;size:"+pointSize+";opacity:1;"
            }
        }

        var gridSizeMap = {
            1: 256, 2:128, 3: 64, 4:32, 5:16, 6:8
        }

        var layer;
        if (gridLayer) {
            layer = L.geoJson(null);
        } else {
            layer = L.tileLayer.wms(MAP_VAR.mappingUrl + "/mapping/wms/reflect" + MAP_VAR.query + MAP_VAR.additionalFqs, {
            layers: 'ALA:occurrences',
            format: 'image/png',
            transparent: true,
            bgcolor:"0x000000",
            outline:outlineDots,
            ENV: envProperty,
            opacity: opacity,
            GRIDDETAIL: gridSizeMap[pointSize],
            STYLE: "opacity:"+opacity, // for grid data
            zIndex: 10
            });
        }

        if (gridLayer) {
            // legend is set by loadGridLayerDensity
        } else if(redraw){
             if(!colourByFacet){
                $('.legendTable').html('');
                addDefaultLegendItem("${grailsApplication.config.getProperty('map.pointColour')}");
             } else if (colourByFacet == 'grid') {
                 $('.legendTable').html('');
                 addGridLegendItem();
             } else {
                //update the legend
                $('.legendTable').html('<tr><td><g:message code="map.loading.legend"/></td></tr>');
                $.ajax({
                    url: "${request.contextPath}/occurrence/legend" + MAP_VAR.query + "&cm=" + colourByFacet + "&type=application/json",
                    success: function(data) {
                        $('.legendTable').html('');

                        $.each(data, function(index, legendDef){
                            var legItemName = legendDef.name ? legendDef.name : '<g:message code="map.legend.not.specified"/>';
                            addLegendItem(legItemName, legendDef.red,legendDef.green,legendDef.blue, legendDef );
                        });

                        $('.layerFacet').click(function(e){
                            var controlIdx = 0;
                            MAP_VAR.additionalFqs = '';
                            MAP_VAR.removeFqs = ''
                            $('#colourByControl').find('.layerFacet').each(function(idx, layerInput){
                                var $input = $(layerInput), fq;
                                var include =  $input.is(':checked');

                                if(!include){
                                    MAP_VAR.additionalFqs = MAP_VAR.additionalFqs + '&HQ=' + controlIdx;
                                    fq = $input.attr('fq');
                                    // logic for facets with missing value is different from those with value
                                    if(fq && fq.startsWith('-')){
                                        // to ignore unknown or missing values, minus sign must be removed
                                         fq = fq.replace('-','');
                                    } else{
                                        // for all other values minus sign has to be added
                                        fq = '-' + fq;
                                    }

                                    // add fq to ensure the query in sync with dots displayed on map
                                    MAP_VAR.removeFqs += '&fq=' + fq;
                                }
                                controlIdx = controlIdx + 1;
                                addQueryLayer(false);
                            });
                        });
                    }
                });
            }
        }
        MAP_VAR.layerControl.addOverlay(layer, 'Occurrences');
        if (!keepHidden) {
            MAP_VAR.map.addLayer(layer);
            if (typeof layer.bringToFront === 'function') {
                layer.bringToFront();
            }
        }
        MAP_VAR.currentLayers.push(layer);

        if (gridLayer) {
            loadGridLayerDensity(layer, gridLayer);
        }

        for (let key in MAP_VAR.overlays) {
            var overlay = MAP_VAR.overlays[key];
            if (!autoSwitch) {
                MAP_VAR.map.addLayer(overlay);
            }
            // keep overlays above the occurrence layer, an auto switch leaves hidden overlays hidden
            if (MAP_VAR.map.hasLayer(overlay) && typeof overlay.bringToFront === 'function') {
                overlay.bringToFront();
            }
        }

        return true;
    }

    function addDefaultLegendItem(pointColour){
        $(".legendTable")
            .append($('<tr>')
                .append($('<td>')
                    .append($('<i>')
                        .addClass('legendColour')
                        .attr('style', "background-color:#"+ pointColour + ";")
                        .attr('id', 'defaultLegendColour')
                    )
                    .append($('<span>')
                        .addClass('legendItemName')
                        .html("<g:message code="map.all.records"/>")
                    )
                )
        );
    }

    function addGridLegendItem(){
        $(".legendTable")
            .append($('<tr>')
                .append($('<td>')
                    .append($('<img id="gridLegendImg" src="' + MAP_VAR.mappingUrl + '/density/legend' + MAP_VAR.query + '"/>'))
                )
        );
    }

    var DEFAULT_GRID_LAYER_COLOURS = ['#fff7bc', '#fec44f', '#fe9929', '#ec7014', '#cc4c02', '#8c2d04'];

    /**
     * The colour classes of the grid cells, from low to high counts: the configured colours, or a ramp from a light
     * tint via the configured colour to a dark shade of it, or the default ramp. Invalid colours are ignored.
     */
    function gridLayerColours(config) {
        var hexColour = /^#?([0-9a-f]{6})$/i;
        var colours = ((config && config.colours) || []).filter(function(colour) {
            return hexColour.test(colour);
        }).map(function(colour) {
            return '#' + colour.replace('#', '').toLowerCase();
        });
        if (colours.length) {
            return colours;
        }
        var base = hexColour.exec((config && config.colour) || '');
        if (!base) {
            return DEFAULT_GRID_LAYER_COLOURS;
        }
        var rgb = [0, 2, 4].map(function(offset) {
            return parseInt(base[1].substr(offset, 2), 16);
        });
        var classes = DEFAULT_GRID_LAYER_COLOURS.length;
        var baseIndex = Math.round((classes - 1) * 0.6); // the class shown in the configured colour itself
        var lightestTint = 0.12; // share of the configured colour in the lightest class, the rest is white
        var darkestShade = 0.6; // share of black in the darkest class
        return DEFAULT_GRID_LAYER_COLOURS.map(function(colour, index) {
            return '#' + rgb.map(function(channel) {
                var value = index <= baseIndex ?
                    255 - (255 - channel) * (lightestTint + (1 - lightestTint) * index / baseIndex) :
                    channel * (1 - darkestShade * (index - baseIndex) / (classes - 1 - baseIndex));
                return ('0' + Math.round(value).toString(16)).slice(-2);
            }).join('');
        });
    }

    var GRID_LAYER_COLOURS = gridLayerColours(GRID_LAYER_COLOUR_CONFIG);

    function setGridLayerLegend(message, layerLabel, minCount, maxCount, scale) {
        var $legend = $('.legendTable').empty();
        if (message) {
            $legend.append($('<tr>').append($('<td>').text(message)));
            return;
        }

        var scaleLabel = scale === 'linear' ? GRID_LAYER_MESSAGES.scaleLinear : GRID_LAYER_MESSAGES.scaleLog;
        $legend.append($('<tr>').append($('<td>').text(layerLabel + ' - ' + GRID_LAYER_MESSAGES.records + ' (' + scaleLabel + ')')));
        gridLayerClassBreaks(minCount, maxCount, scale).forEach(function(gridClass) {
            var range = gridClass.from === gridClass.to ? gridClass.from.toLocaleString() :
                gridClass.from.toLocaleString() + ' - ' + gridClass.to.toLocaleString();
            $legend.append($('<tr>').append($('<td>')
                .append($('<i>').addClass('legendColour').css('background-color', gridClass.colour))
                .append($('<span>').addClass('legendItemName').text(range))));
        });
    }

    /**
     * The count range of each colour class, derived from gridLayerColourIndex so the legend always matches the map.
     * Classes that contain no whole counts are left out.
     */
    function gridLayerClassBreaks(minCount, maxCount, scale) {
        if (maxCount === minCount) {
            return [{colour: GRID_LAYER_COLOURS[GRID_LAYER_COLOURS.length - 1], from: minCount, to: maxCount}];
        }
        var lowerBounds = GRID_LAYER_COLOURS.map(function(colour, index) {
            var fraction = index / GRID_LAYER_COLOURS.length;
            var threshold = scale === 'linear' ?
                minCount + fraction * (maxCount - minCount) :
                Math.exp(Math.log(minCount) + fraction * (Math.log(maxCount) - Math.log(minCount)));
            // correct for floating point rounding around the threshold
            var lower = Math.max(minCount, Math.ceil(threshold));
            while (lower > minCount && gridLayerColourIndex(lower - 1, minCount, maxCount, scale) >= index) lower--;
            while (lower <= maxCount && gridLayerColourIndex(lower, minCount, maxCount, scale) < index) lower++;
            return lower;
        });
        return GRID_LAYER_COLOURS.map(function(colour, index) {
            var to = index + 1 < lowerBounds.length ? lowerBounds[index + 1] - 1 : maxCount;
            return {colour: colour, from: lowerBounds[index], to: Math.min(to, maxCount)};
        }).filter(function(gridClass) {
            return gridClass.from <= gridClass.to;
        });
    }

    /**
     * The display to draw for a 'Display' selection: an auto display resolves to the layer of its first step whose
     * maxZoom is at least the zoom level, with 'points' meaning the default points (''). Steps whose grid layer is
     * outside its own minZoom / maxZoom at this zoom level are skipped. Without a matching step the last step is used.
     * Any other selection is returned unchanged.
     */
    function resolveMapDisplay(selection, zoom) {
        var autoDisplay = AUTO_DISPLAYS[selection];
        if (!autoDisplay) {
            return selection;
        }
        var steps = autoDisplay.steps;
        var step = steps.filter(function(candidate) {
            var gridLayer = GRID_LAYERS[candidate.layer];
            var layerShowsZoom = !gridLayer ||
                (zoom >= (gridLayer.minZoom || 0) && (gridLayer.maxZoom == null || zoom <= gridLayer.maxZoom));
            return layerShowsZoom && (candidate.maxZoom == null || zoom <= candidate.maxZoom);
        })[0] || steps[steps.length - 1];
        return step.layer === 'points' ? '' : step.layer;
    }

    function gridLayerLabel(gridLayer) {
        return GRID_LAYER_LABELS[gridLayer.id] || gridLayer.id;
    }

    function buildGridCellFilterUrl(gridLayer, cellCode) {
        var queryParams = new URLSearchParams((MAP_VAR.query || '?q=*:*').replace(/^\?/, ''));
        var existingFilters = queryParams.getAll('fq').filter(function(filter) {
            return filter.trim().replace(/^-/, '').indexOf(gridLayer.facet + ':') !== 0;
        });
        queryParams.delete('fq');
        existingFilters.forEach(function(filter) {
            queryParams.append('fq', filter);
        });
        queryParams.append('fq', gridLayer.facet + ':"' + cellCode + '"');

        return window.location.pathname + '?' + queryParams.toString() + window.location.hash;
    }

    /**
     * Invalidate and abort any in-flight grid layer request, so late responses are ignored.
     */
    function cancelGridLayerRequests() {
        MAP_VAR.gridLayerRequestId++;
        if (MAP_VAR.gridLayerXhr) {
            MAP_VAR.gridLayerXhr.abort();
            MAP_VAR.gridLayerXhr = null;
        }
    }

    /**
     * Colour index for a count. The default log scale suits the usually heavily skewed record counts per cell,
     * scale 'linear' spreads the colours evenly between the minimum and maximum count.
     */
    function gridLayerColourIndex(count, minCount, maxCount, scale) {
        if (maxCount === minCount) {
            return GRID_LAYER_COLOURS.length - 1;
        }
        var fraction = scale === 'linear' ?
            (count - minCount) / (maxCount - minCount) :
            (Math.log(count) - Math.log(minCount)) / (Math.log(maxCount) - Math.log(minCount));
        return Math.min(GRID_LAYER_COLOURS.length - 1, Math.floor(fraction * GRID_LAYER_COLOURS.length));
    }

    function loadGridLayerDensity(layer, gridLayer) {
        cancelGridLayerRequests();
        var requestId = MAP_VAR.gridLayerRequestId;
        layer.clearLayers();

        var zoom = MAP_VAR.map.getZoom();
        if (zoom < (gridLayer.minZoom || 0)) {
            setGridLayerLegend(GRID_LAYER_MESSAGES.zoom);
            return;
        }
        if (gridLayer.maxZoom != null && zoom > gridLayer.maxZoom) {
            setGridLayerLegend(GRID_LAYER_MESSAGES.zoomOut);
            return;
        }
        setGridLayerLegend(GRID_LAYER_MESSAGES.loading);

        var cellProperty = gridLayer.cellProperty || 'TAG';
        var bounds = MAP_VAR.map.getBounds();
        var queryParams = new URLSearchParams((MAP_VAR.query || '?q=*:*').replace(/^\?/, ''));
        queryParams.set('facets', gridLayer.facet);
        queryParams.set('flimit', '-1');
        queryParams.set('pageSize', '0');
        if (MAP_VAR.removeFqs) {
            new URLSearchParams(MAP_VAR.removeFqs.replace(/^&/, '')).forEach(function(value, key) {
                queryParams.append(key, value);
            });
        }
        var serviceUrl = MAP_VAR.mappingUrl.replace(/\/$/, '');
        var wfsData = {
            service: 'WFS',
            version: '1.0.0',
            request: 'GetFeature',
            typeName: gridLayer.wfsLayer,
            outputFormat: 'application/json',
            srsName: 'EPSG:4326',
            bbox: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth(), 'EPSG:4326'].join(','),
            maxFeatures: gridLayer.maxFeatures + 1
        };

        function cellCode(feature) {
            return feature.properties ? feature.properties[cellProperty] : undefined;
        }

        MAP_VAR.gridLayerXhr = $.ajax({url: MAP_VAR.gridLayerWfsUrl, data: wfsData, dataType: 'json'});
        MAP_VAR.gridLayerXhr.then(function(featureData) {
            if (requestId !== MAP_VAR.gridLayerRequestId) return;

            var totalFeatures = Number(featureData.totalFeatures || featureData.numberMatched || featureData.features.length);
            if (featureData.features.length > gridLayer.maxFeatures || totalFeatures > gridLayer.maxFeatures) {
                setGridLayerLegend(GRID_LAYER_MESSAGES.zoom);
                return;
            }
            if (!featureData.features.length) {
                setGridLayerLegend(GRID_LAYER_MESSAGES.empty);
                return;
            }

            // restrict the count query to the extent of the returned cells, which covers edge cells completely
            var cellBounds = L.geoJson(featureData).getBounds();
            queryParams.append('fq', 'decimalLatitude:[' + cellBounds.getSouth() + ' TO ' + cellBounds.getNorth() + ']');
            queryParams.append('fq', 'decimalLongitude:[' + cellBounds.getWest() + ' TO ' + cellBounds.getEast() + ']');

            MAP_VAR.gridLayerXhr = $.ajax({url: serviceUrl + '/occurrences/search.json?' + queryParams.toString(), dataType: 'json'});
            return MAP_VAR.gridLayerXhr.then(function(searchData) {
                if (requestId !== MAP_VAR.gridLayerRequestId) return;
                MAP_VAR.gridLayerXhr = null;

                var facetResult = (searchData.facetResults || []).filter(function(result) {
                    return result.fieldName === gridLayer.facet;
                })[0];
                var counts = {};
                (facetResult ? facetResult.fieldResult : []).forEach(function(result) {
                    counts[result.label] = Number(result.count);
                });

                var visibleFeatures = featureData.features.filter(function(feature) {
                    return counts[cellCode(feature)] > 0;
                });
                if (!visibleFeatures.length) {
                    setGridLayerLegend(GRID_LAYER_MESSAGES.empty);
                    return;
                }

                var visibleCounts = visibleFeatures.map(function(feature) {
                    return counts[cellCode(feature)];
                });
                var maxCount = Math.max.apply(null, visibleCounts);
                var minCount = Math.min.apply(null, visibleCounts);

                layer.addData({type: 'FeatureCollection', features: visibleFeatures});
                var opacity = parseFloat($('#opacityslider-val').text());
                layer.setStyle(function(feature) {
                    var colourIndex = gridLayerColourIndex(counts[cellCode(feature)], minCount, maxCount, gridLayer.scale);
                    return {color: '#555', weight: 0.6, fillColor: GRID_LAYER_COLOURS[colourIndex], fillOpacity: opacity};
                });
                layer.eachLayer(function(cellLayer) {
                    var code = cellCode(cellLayer.feature);
                    var recordsLink = $('<a>').attr('href', buildGridCellFilterUrl(gridLayer, code))
                        .text(counts[code].toLocaleString() + ' ' + GRID_LAYER_MESSAGES.records);
                    var popup = $('<div>').append($('<strong>').text(code)).append('<br>')
                        .append(recordsLink);
                    cellLayer.bindPopup(popup[0]);
                });

                setGridLayerLegend(null, gridLayerLabel(gridLayer), minCount, maxCount, gridLayer.scale);
            });
        }).fail(function() {
            if (requestId === MAP_VAR.gridLayerRequestId) {
                MAP_VAR.gridLayerXhr = null;
                setGridLayerLegend(GRID_LAYER_MESSAGES.error);
            }
        });
    }

    function addLegendItem(name, red, green, blue, data){
        var nameLabel = jQuery.i18n.prop(name);
        var isoDateRegEx = /^(\d{4})-\d{2}-\d{2}T.*/; // e.g. 2001-02-31T12:00:00Z with year capture
        if (name.search(isoDateRegEx) > -1) {
            // convert full ISO date to YYYY-MM-DD format
            name = name.replace(isoDateRegEx, "$1");
        }
        $(".legendTable")
            .append($('<tr>')
                .append($('<td>')
                    .append($('<input>')
                        .attr('type', 'checkbox')
                        .attr('checked', 'checked')
                        .attr('id', name)
                        .attr('fq',data.fq)
                        .addClass('layerFacet')
                        .addClass('leaflet-control-layers-selector')
                    )
                )
                .append($('<td>')
                    .append($('<i>')
                        .addClass('legendColour')
                        .attr('style', "background-color:rgb("+ red +","+ green +","+ blue + ");")
                    )
                    .append($('<span>')
                        .addClass('legendItemName')
                        .html((nameLabel.indexOf("[") == -1) ? nameLabel : name)
                    )
                )
        );
    }

    function rgbToHex(redD, greenD, blueD){
        var red = parseInt(redD);
        var green = parseInt(greenD);
        var blue = parseInt(blueD);

        var rgb = blue | (green << 8) | (red << 16);
        return rgb.toString(16);
    }



    function getRecordInfo(){
        // http://biocache.ala.org.au/ws/occurrences/c00c2f6a-3ae8-4e82-ade4-fc0220529032
        //console.log("MAP_VAR.query", MAP_VAR.query);
        $.ajax({
            url: "${alatag.getBiocacheAjaxUrl()}/occurrences/info" + MAP_VAR.query,
            //jsonp: "callback",
            //dataType: "jsonp",
            success: function(response) {
            }
        });
    }


    /**
     * Zooms map to either spatial search or from WMS data bounds
     */
    function fitMapToBounds() {
        // Don't run for spatial searches, which have their own fitBounds() method
        if (true || !isSpatialRadiusSearch()) { // inactive if
            // all other searches (non-spatial)
            // do webservice call to get max extent of WMS data
            var jsonUrl = "${alatag.getBiocacheAjaxUrl()}/mapping/bounds" + MAP_VAR.query;
            $.getJSON(jsonUrl, function(data) {
                if (data.length == 4) {
                    //console.log("data", data);
                    var sw = L.latLng(data[1],data[0]);
                    var ne = L.latLng(data[3],data[2]);
                    //console.log("sw", sw.toString());
                    var dataBounds = L.latLngBounds(sw, ne);
                    //var centre = dataBounds.getCenter();
                    var mapBounds = MAP_VAR.map.getBounds();

                    if (mapBounds && mapBounds.contains(sw) && mapBounds.contains(ne) && dataBounds) {
                        // data bounds is smaller than the default map bounds/view, so zoom into fit data
                        MAP_VAR.map.fitBounds(dataBounds);

                        if (MAP_VAR.map.getZoom() > 15) {
                            MAP_VAR.map.setZoom(15);
                        }
                    } else if (!mapBounds.contains(dataBounds) && !mapBounds.intersects(dataBounds)) {
                        // if data is not present in the default map bounds/view, then zoom to data
                        MAP_VAR.map.fitBounds(dataBounds);
                        if (MAP_VAR.map.getZoom() > 3) {
                            MAP_VAR.map.setZoom(3);
                        }
                    } else if (MAP_VAR.zoomOutsideScopedRegion) {
                        // if data is present in default map view but also outside that area, then zoom to data bounds
                        // as long as zoomOutsideScopedRegion is true, otherwise keep default zoom/bounds

                        // fitBounds is async so we set a one time only listener to detect change
                        MAP_VAR.map.once('zoomend', function() {
                            //console.log("zoomend", MAP_VAR.map.getZoom());
                            if (MAP_VAR.map.getZoom() < 2) {
                                MAP_VAR.map.setView(L.latLng(0, 24), 2); // zoom level 2 and centered over africa
                            }
                        });
                        MAP_VAR.map.fitBounds(dataBounds);
                    }
                    MAP_VAR.map.invalidateSize();
                }
            });
        }
    }

    /**
     * Spatial searches from Explore Your Area - draw a circle representing
     * the radius boundary for the search.
     */
    function drawCircleRadius() {
        if (isSpatialRadiusSearch()) {
            // spatial search from EYA
            var lat = getUrlParam('lat');
            var lng = getUrlParam('lon');
            var radius = getUrlParam('radius');
            var latLng = L.latLng(lat, lng);
            var circleOpts = {
                weight: 1,
                color: 'white',
                opacity: 0.5,
                fillColor: '#222', // '#2C48A6'
                fillOpacity: 0.2
            }

            // Leaflet 1.x appends the file name directly, so the path needs a trailing slash
            L.Icon.Default.imagePath = "${assetPath(src:'/leaflet/images')}/";
            var popupText = "<g:message code="map.center.spatial.search.radius" args="${[radius]}"/>";
            var circle = L.circle(latLng, radius * 1030, circleOpts);
            circle.addTo(MAP_VAR.map);
            MAP_VAR.map.fitBounds(circle.getBounds()); // make circle the centre of the map, not the points
            L.marker(latLng, {title: popupText}).bindPopup(popupText).addTo(MAP_VAR.map);
            MAP_VAR.map.invalidateSize();
        }
    }

    /**
     * Returns true for a lat/lon/radius (params) style search
     *
     * @returns {boolean}
     */
    function isSpatialRadiusSearch() {
        var returnBool = false;
        var lat = getUrlParam('lat');
        var lng = getUrlParam('lon');
        var radius = getUrlParam('radius');

        if (lat && lng && radius) {
            returnBool = true;
        }

        return returnBool
    }

    /**
     * http://stackoverflow.com/questions/3916191/download-data-url-file
     */
    function downloadPolygon() {
      var uri = "data:text/html,${params.wkt}",
          name = "polygon.txt";
      var link = document.createElement("a");
      link.download = name;
      link.href = uri;
      //console.log("downloadPolygon",link);
      document.body.appendChild(link);
      link.click();
      // Cleanup the DOM
      document.body.removeChild(link);
      delete link;
      return false;
    }
</asset:script>
<g:render template="mapPopup"></g:render>
<g:if test="${spatialEnableQualityWarning}">
<div id="gotoSpatial" class="modal fade" tabindex="-1" role="dialog" >
    <div class="modal-dialog" role="document">
        <div class="modal-content">
            <div class="modal-header">
                <button type="button" class="close" data-dismiss="modal" aria-hidden="true">×</button>
                <h3 class="text-danger"><g:message code="map.spatialportal.redirect.title" default="Warning"/></h3>
            </div>
            <div class="modal-body">
                <g:message code="map.spatialportal.redirect.content" default="Please be aware that Data Quality filters will not be applied when records are viewed in Spatial Portal."/>
            </div>
            <div class="modal-footer">
                <button class="btn btn-default" data-dismiss="modal" aria-hidden="true"><g:message code="map.spatialportal.redirect.btn.cancel.label" default="Cancel"/></button>
                <a class="btn btn-primary" href="${grailsApplication.config.getProperty('spatial.baseUrl')}${spatialPortalLink}${spatialPortalUrlParams}" title="<g:message code="map.spatialportal.btn.title.param" args="${[shortName]}"/>"><g:message code="map.spatialportal.redirect.btn.ok.label" default="Go to Spatial Portal"/></a>
            </div>
        </div>
    </div>
</div>
</g:if>

<div id="downloadMap" class="modal fade" tabindex="-1" role="dialog" aria-labelledby="downloadsMapLabel">
    <div class="modal-dialog" role="document">
        <div class="modal-content">
            <form id="downloadMapForm" class="form-horizontal" role="form">
                <div class="modal-header">
                    <button type="button" class="close" data-dismiss="modal" aria-hidden="true">×</button>
                    <h3 id="downloadsMapLabel"><g:message code="map.downloadmap.title" default="Download map as image file"/></h3>
                </div>
                <div class="modal-body">
                    <input id="mapDownloadUrl" type="hidden" value="${alatag.getBiocacheAjaxUrl()}/webportal/wms/image"/>
                    <div class="form-group">
                        <label for="format" class="col-md-5 control-label"><g:message code="map.downloadmap.field01.label" default="Format"/></label>
                        <div class="col-md-6">
                            <select name="format" id="format" class="form-control">
                                <option value="jpg"><g:message code="map.downloadmap.field01.option01" default="JPEG"/></option>
                                <option value="png"><g:message code="map.downloadmap.field01.option02" default="PNG"/></option>
                            </select>
                        </div>
                    </div>
                    <div class="form-group">
                        <label for="dpi" class="col-md-5 control-label"><g:message code="map.downloadmap.field02.label" default="Quality (DPI)"/></label>
                        <div class="col-md-6">
                            <select name="dpi" id="dpi" class="form-control">
                                <option value="100">100</option>
                                <option value="300" selected="true">300</option>
                                <option value="600">600</option>
                            </select>
                        </div>
                    </div>
                    <div class="form-group">
                        <label for="pradiusmm" class="col-md-5 control-label"><g:message code="map.downloadmap.field03.label" default="Point radius (mm)"/></label>
                        <div class="col-md-6">
                            <select name="pradiusmm" id="pradiusmm" class="form-control">
                                <option>0.1</option>
                                <option>0.2</option>
                                <option>0.3</option>
                                <option>0.4</option>
                                <option>0.5</option>
                                <option>0.6</option>
                                <option selected="true">0.7</option>
                                <option>0.8</option>
                                <option>0.9</option>
                                <option>1</option>
                                <option>2</option>
                                <option>3</option>
                                <option>4</option>
                                <option>5</option>
                                <option>6</option>
                                <option>7</option>
                                <option>8</option>
                                <option>9</option>
                                <option>10</option>
                            </select>
                        </div>
                    </div>
                    <div class="form-group">
                        <label for="popacity" class="col-md-5 control-label"><g:message code="map.downloadmap.field04.label" default="Opacity"/></label>
                        <div class="col-md-6">
                            <select name="popacity" id="popacity" class="form-control">
                                <option>1</option>
                                <option>0.9</option>
                                <option>0.8</option>
                                <option selected="true">0.7</option>
                                <option>0.6</option>
                                <option>0.5</option>
                                <option>0.4</option>
                                <option>0.3</option>
                                <option>0.2</option>
                                <option>0.1</option>
                            </select>
                        </div>
                    </div>
                    <div class="form-group">
                        <label for="colourPickerWrapper" class="col-md-5 control-label"><g:message code="map.downloadmap.field05.label" default="Color"/></label>
                        <div class="col-md-6">
                            <input type="color" name="pcolour" id="pcolour" class="form-control" value="#0D00FB">
                        </div>
                    </div>
                    <div class="form-group">
                        <label for="widthmm" class="col-md-5 control-label"><g:message code="map.downloadmap.field06.label" default="Width (mm)"/></label>
                        <div class="col-md-6">
                            <input type="text" name="widthmm" id="widthmm" class="form-control" value="150" />
                        </div>
                    </div>
                    <div class="form-group">
                        <label for="scale_on" class="col-md-5 control-label"><g:message code="map.downloadmap.field07.label" default="Include scale"/></label>
                        <div class="col-md-6">
                            <div class="form-control" style="border: none; box-shadow: none;">
                                <input type="radio" name="scale" value="on" id="scale_on" class="form-controlX" checked="checked"/> <g:message code="map.downloadmap.field07.option01" default="Yes"/> &nbsp;
                                <input type="radio" name="scale" value="off" class="form-controlX" /> <g:message code="map.downloadmap.field07.option02" default="No"/>
                            </div>
                        </div>
                    </div>
                    <div class="form-group">
                        <label for="outline" class="col-md-5 control-label"><g:message code="map.downloadmap.field08.label" default="Outline points"/></label>
                        <div class="col-md-6">
                            <div class="form-control" style="border: none; box-shadow: none;">
                                <input type="radio" name="outline" value="true" id="outline" class="form-controlX" checked="checked"/> <g:message code="map.downloadmap.field08.option01" default="Yes"/> &nbsp;
                                <input type="radio" name="outline" value="false" class="form-controlX" /> <g:message code="map.downloadmap.field08.option02" default="No"/>
                            </div>
                            </div>
                    </div>
                    <div class="form-group">
                        <label for="baseMap" class="col-md-5 control-label"><g:message code="map.downloadmap.field09.label" default="Base layer"/></label>
                        <div class="col-md-6">
                            <select name="baseMap" id="baseMap" class="form-control">
                                <g:each in="${grailsApplication.config.getProperty('mapdownloads.baseMaps', Map, [:])}" var="baseMap">
                                    <option value="basemap.${baseMap.value.name}"><g:message code="${baseMap.value.i18nCode}" default="${baseMap.value.displayName}"/></option>
                                </g:each>
                                <g:each in="${grailsApplication.config.getProperty('mapdownloads.baseLayers', Map, [:])}" var="baseLayer">
                                    <option value="baselayer.${baseLayer.value.name}"><g:message code="${baseLayer.value.i18nCode}" default="${baseLayer.value.displayName}"/></option>
                                </g:each>
                            </select>
                        </div>
                    </div>
                    <div class="form-group">
                        <label for="fileName" class="col-md-5 control-label"><g:message code="map.downloadmap.field10.label" default="File name (without extension)"/></label>
                        <div class="col-md-6">
                            <input type="text" name="fileName" id="fileName" class="form-control" value="MyMap"/>
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-default" data-dismiss="modal" aria-hidden="true"><g:message code="map.downloadmap.button02.label" default="Close"/></button>
                    <button id="submitDownloadMap" class="btn btn-primary"><g:message code="map.downloadmap.button01.label" default="Download map"/></button>
                </div>
            </form>
        </div>
    </div>
</div>



<script type="text/javascript">

    $(document).ready(function(){

        // restrict search to current map bounds/view
        $('#wktFromMapBounds').click(function(e) {
            e.preventDefault();
            var b = MAP_VAR.map.getBounds();
            var wkt = "POLYGON ((" + b.getWest() + " " + b.getSouth() + ", " +
                    b.getEast()  + " " + b.getSouth() + ", " +
                    b.getEast()  + " " + b.getNorth() + ", " +
                    b.getWest()  + " " + b.getNorth() + ", " +
                    b.getWest() + " " + b.getSouth() + "))";
            //console.log('wkt', wkt);
            var url = "${g.createLink(uri:'/occurrences/search')}" + MAP_VAR.query + "&wkt=" + encodeURIComponent(wkt);
            //console.log('new url', url);
            window.location.href = url;
        });
    });

    $('#submitDownloadMap').click(function(e){
        e.preventDefault();
        downloadMapNow();
    });

    function downloadMapNow(){

        var bounds = MAP_VAR.map.getBounds();
        var ne =  bounds.getNorthEast();
        var sw =  bounds.getSouthWest();
        var extents = sw.lng + ',' + sw.lat + ',' + ne.lng + ','+ ne.lat;

        var baseMapValue = $('#baseMap').val();
        var baseLayer = "";
        var baseMap = "";
        if (baseMapValue.startsWith("basemap")){
            baseMap = baseMapValue.substring(8);
        } else if (baseMapValue.startsWith("baselayer")){
            baseLayer = baseMapValue.substring(10);
        }

        var downloadUrl =  $('#mapDownloadUrl').val() +
                window.__hubDecode("<alatag:b64 value="${sr?.urlParameters}"/>") +
                '&extents=' + extents +  //need to retrieve the
                '&format=' + $('#format').val() +
                '&dpi=' + $('#dpi').val() +
                '&pradiusmm=' + $('#pradiusmm').val() +
                '&popacity=' + $('#popacity').val() +
                '&pcolour=' + $(':input[name=pcolour]').val().replace('#','').toUpperCase() +
                '&widthmm=' + $('#widthmm').val() +
                '&scale=' + $(':input[name=scale]:checked').val() +
                '&outline=' + $(':input[name=outline]:checked').val() +
                '&outlineColour=0x000000' +
                '&baselayer=' + baseLayer +
                '&baseMap=' + baseMap +
                '&fileName=' + $('#fileName').val()+'.'+$('#format').val().toLowerCase();

        //console.log('downloadUrl', downloadUrl);
        $('#downloadMap').modal('hide');
        document.location.href = downloadUrl;
    }
</script>
