import React, { useState } from 'react';
import { Box, Paper, Typography, Stack } from '@mui/material';
import {
  ComposableMap,
  Geographies,
  Geography,
  Marker,
  ZoomableGroup } from
'react-simple-maps';
import { Entity, statusColor, statusLabel } from '../data/entities';
import { useEntities } from '../../data/DataProvider';
// Public world topology (countries) — 110m resolution, light enough for dashboards
const GEO_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';
interface HoverState {
  e: Entity;
  x: number;
  y: number;
}
export default function WorldMap({
  onEntityClick


}: {onEntityClick?: (e: Entity) => void;}) {
  const entities = useEntities();
  const [hover, setHover] = useState<HoverState | null>(null);
  const [containerRef, setContainerRef] = useState<HTMLDivElement | null>(null);
  const handleMouseMove = (e: Entity) => (event: React.MouseEvent) => {
    if (!containerRef) return;
    const rect = containerRef.getBoundingClientRect();
    setHover({
      e,
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    });
  };
  return (
    <Paper
      sx={{
        p: 2.5
      }}>
      
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="flex-start"
        sx={{
          mb: 1.5,
          flexWrap: 'wrap',
          gap: 1
        }}>
        
        <Box>
          <Typography
            variant="subtitle1"
            sx={{
              fontWeight: 700
            }}>
            
            Global Entity Map
          </Typography>
          <Typography
            variant="caption"
            sx={{
              color: '#64748B'
            }}>
            
            {entities.length} entities across {new Set(entities.map((e) => e.countryCode)).size} countries • Hover a dot for details
          </Typography>
        </Box>
        <Stack
          direction="row"
          spacing={1.5}
          alignItems="center"
          sx={{
            flexWrap: 'wrap'
          }}>
          
          {(['in-range', 'watch', 'out-of-range'] as const).map((s) =>
          <Stack key={s} direction="row" alignItems="center" spacing={0.5}>
              <Box
              sx={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                bgcolor: statusColor[s]
              }} />
            
              <Typography
              variant="caption"
              sx={{
                color: '#475569',
                fontWeight: 500
              }}>
              
                {statusLabel[s]}
              </Typography>
            </Stack>
          )}
        </Stack>
      </Stack>

      <Box
        ref={setContainerRef}
        sx={{
          position: 'relative',
          width: '100%',
          bgcolor: '#F8FAFC',
          borderRadius: 1.5,
          overflow: 'hidden',
          border: '1px solid #EEF2F7'
        }}>
        
        <ComposableMap
          projection="geoEqualEarth"
          projectionConfig={{
            scale: 165,
            center: [10, 20]
          }}
          width={980}
          height={460}
          style={{
            width: '100%',
            height: 'auto',
            display: 'block'
          }}>
          
          <ZoomableGroup zoom={1} minZoom={1} maxZoom={4} center={[10, 20]}>
            <Geographies geography={GEO_URL}>
              {({ geographies }) =>
              geographies.map((geo) =>
              <Geography
                key={geo.rsmKey}
                geography={geo}
                style={{
                  default: {
                    fill: '#E2E8F0',
                    stroke: '#CBD5E1',
                    strokeWidth: 0.5,
                    outline: 'none'
                  },
                  hover: {
                    fill: '#CBD5E1',
                    stroke: '#94A3B8',
                    strokeWidth: 0.5,
                    outline: 'none'
                  },
                  pressed: {
                    fill: '#CBD5E1',
                    outline: 'none'
                  }
                }} />

              )
              }
            </Geographies>

            {entities.map((e) => {
              const color = statusColor[e.status];
              return (
                <Marker
                  key={e.id}
                  coordinates={[e.lng, e.lat]}
                  onMouseEnter={handleMouseMove(e)}
                  onMouseMove={handleMouseMove(e)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => onEntityClick?.(e)}
                  style={{
                    default: {
                      cursor: onEntityClick ? 'pointer' : 'default',
                      outline: 'none'
                    },
                    hover: {
                      outline: 'none'
                    },
                    pressed: {
                      outline: 'none'
                    }
                  }}>
                  
                  <circle r={10} fill={color} fillOpacity={0.18} />
                  <circle
                    r={5.5}
                    fill={color}
                    stroke="#ffffff"
                    strokeWidth={1.5}>
                    
                    <title>
                      {e.id} — {e.name}
                    </title>
                  </circle>
                </Marker>);

            })}
          </ZoomableGroup>
        </ComposableMap>

        {hover && containerRef &&
        <Box
          sx={{
            position: 'absolute',
            left: Math.min(
              Math.max(hover.x, 130),
              containerRef.clientWidth - 130
            ),
            top: Math.max(hover.y - 14, 10),
            transform: 'translate(-50%, -100%)',
            bgcolor: 'white',
            border: '1px solid #E2E8F0',
            borderRadius: 1.5,
            boxShadow: '0 10px 25px rgba(15,23,42,0.14)',
            p: 1.25,
            minWidth: 230,
            pointerEvents: 'none',
            zIndex: 2
          }}>
          
            <Typography
            variant="caption"
            sx={{
              color: '#64748B',
              fontWeight: 600
            }}>
            
              {hover.e.id} • {hover.e.country}
            </Typography>
            <Typography
            variant="body2"
            sx={{
              fontWeight: 700,
              mb: 0.5
            }}>
            
              {hover.e.name}
            </Typography>
            <Typography
            variant="caption"
            sx={{
              display: 'block',
              color: '#475569'
            }}>
            
              Function: {hover.e.function}
            </Typography>
            {hover.e.actualMargin !== null &&
          <Typography
            variant="caption"
            sx={{
              display: 'block',
              color: '#475569'
            }}>
            
                Margin: <b>{hover.e.actualMargin}%</b> vs. target{' '}
                {hover.e.targetMarginLabel}
              </Typography>
          }
            <Box
            sx={{
              mt: 0.75,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.5,
              px: 0.75,
              py: 0.25,
              borderRadius: 0.75,
              bgcolor: `${statusColor[hover.e.status]}15`
            }}>
            
              <Box
              sx={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                bgcolor: statusColor[hover.e.status]
              }} />
            
              <Typography
              variant="caption"
              sx={{
                color: statusColor[hover.e.status],
                fontWeight: 700
              }}>
              
                {statusLabel[hover.e.status]}
              </Typography>
            </Box>
          </Box>
        }
      </Box>
    </Paper>);

}