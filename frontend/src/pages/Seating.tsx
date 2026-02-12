import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  Stack,
  Paper,
  TextField,
  InputAdornment,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  List,
  ListItem,
  ListItemText,
  Divider,
  useTheme,
  useMediaQuery,
  SelectChangeEvent,
  Tooltip,
  Menu,
  ListItemIcon,
  Popover,
  Autocomplete,
  Card,
  CardContent,
  Alert,
  CircularProgress,
  Drawer,
  alpha,
} from '@mui/material';
import {
  Add as AddIcon,
  Save as SaveIcon,
  Cancel as CancelIcon,
  PictureAsPdf as PictureAsPdfIcon,
  Search as SearchIcon,
  FilterList as FilterListIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  PersonAdd as PersonAddIcon,
} from '@mui/icons-material';
import ReactFlow, {
  Node,
  Edge,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  Position,
  NodeTypes,
  Handle,
} from 'reactflow';
import 'reactflow/dist/style.css';

// Import types and mock data
import { Guest, Table, statusColors, statusLabels } from '../mocks/guestData';
import { useEvent } from '../contexts/EventContext';
import { useGuests } from '../hooks/useOverviewData';
import { fetchWithAuth } from '../utils/fetchWithAuth';

// Map API guest to seating Guest (count = guest_count ?? import_count for capacity)
function mapGuestFromAPI(apiGuest: any): Guest {
  const statusMap: Record<string, 'pending' | 'confirmed' | 'declined' | 'maybe'> = {
    invited: 'pending', pending: 'pending', attending: 'confirmed', confirmed: 'confirmed',
    declined: 'declined', maybe: 'maybe',
  };
  const count = apiGuest.guest_count != null ? apiGuest.guest_count : (apiGuest.import_count ?? 1);
  return {
    _id: apiGuest.id,
    eventId: apiGuest.event_id,
    name: apiGuest.name,
    phone: apiGuest.phone,
    email: apiGuest.email,
    group: apiGuest.group || '',
    status: statusMap[apiGuest.status] || 'pending',
    source: 'manual',
    note: apiGuest.notes,
    confirmedCount: count,
    expectedCount: apiGuest.import_count,
    tableNumber: apiGuest.table_number ?? undefined,
    lastResponse: apiGuest.last_response ? new Date(apiGuest.last_response) : undefined,
  };
}

// Update DraggableGuest component
const DraggableGuest = ({ guest }: { guest: Guest }) => {
  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('guest', JSON.stringify(guest));
  };
  const seatCount = guest.confirmedCount ?? guest.expectedCount ?? 1;

  return (
    <Card
      draggable
      onDragStart={handleDragStart}
      sx={{
        mb: 1,
        cursor: 'move',
        backgroundColor: 'background.paper',
        '&:hover': {
          backgroundColor: 'action.hover',
        },
      }}
    >
      <CardContent sx={{ py: 1, '&:last-child': { pb: 1 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box>
            <Typography variant="body1">
              {guest.name}
              {seatCount > 1 && (
                <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 0.5 }}>
                  ({seatCount})
                </Typography>
              )}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {guest.group}
            </Typography>
          </Box>
          <Chip
            label={statusLabels[guest.status]}
            size="small"
            sx={{
              backgroundColor: `${statusColors[guest.status]}20`,
              color: statusColors[guest.status],
            }}
          />
        </Box>
      </CardContent>
    </Card>
  );
};

// Update TableNode component
const TableNode = ({ data }: { data: { table: Table; guests: Guest[]; onSeatClick: (tableId: string, seatIndex: number) => void; onTableEdit: (table: Table) => void; onTableDelete: (tableId: string) => void; onGuestDrop: (guest: Guest, tableId: string) => void } }) => {
  const { table, guests, onSeatClick, onTableEdit, onTableDelete, onGuestDrop } = data;
  const [contextMenu, setContextMenu] = useState<{
    mouseX: number;
    mouseY: number;
  } | null>(null);
  const [isOver, setIsOver] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsOver(true);
  };

  const handleDragLeave = () => {
    setIsOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsOver(false);
    try {
      const guest = JSON.parse(e.dataTransfer.getData('guest')) as Guest;
      onGuestDrop(guest, table.id);
    } catch (error) {
      console.error('Failed to parse guest data:', error);
    }
  };

  const handleContextMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    setContextMenu({
      mouseX: event.clientX - 2,
      mouseY: event.clientY - 4,
    });
  };

  const handleClose = () => {
    setContextMenu(null);
  };

  const handleEdit = () => {
    onTableEdit(table);
    handleClose();
  };

  const handleDelete = () => {
    onTableDelete(table.id);
    handleClose();
  };

  const seats: React.ReactElement[] = [];
  const centerX = table.size.width / 2;
  const centerY = table.size.height / 2;

  const guestSeatCount = (g: Guest) => g.confirmedCount ?? g.expectedCount ?? 1;

  function renderSeat(index: number, x: number, y: number) {
    const guestId = table.seatAssignments[index.toString()];
    const assignedGuest = guestId ? guests.find((g: Guest) => g._id === guestId) : null;
    const positionInBlock = assignedGuest && guestId
      ? (() => {
          const indices = Object.entries(table.seatAssignments)
            .filter(([_, id]) => id === guestId)
            .map(([k]) => parseInt(k, 10))
            .sort((a, b) => a - b);
          const pos = indices.indexOf(index) + 1;
          return pos;
        })()
      : 0;
    const blockSize = assignedGuest ? guestSeatCount(assignedGuest) : 0;
    const tooltipTitle = assignedGuest
      ? blockSize > 1
        ? `${assignedGuest.name} (${positionInBlock}/${blockSize})`
        : assignedGuest.name
      : '';

    seats.push(
      <Box
        key={index}
        onClick={(e) => {
          e.stopPropagation();
          onSeatClick(table.id, index);
        }}
        sx={{
          position: 'absolute',
          left: x - 15,
          top: y - 15,
          width: 30,
          height: 30,
          borderRadius: '50%',
          backgroundColor: assignedGuest ? statusColors[assignedGuest.status as keyof typeof statusColors] : 'background.paper',
          border: '2px solid',
          borderColor: 'primary.main',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          '&:hover': {
            backgroundColor: 'action.hover',
          },
        }}
      >
        {assignedGuest && (
          <Tooltip title={tooltipTitle}>
            <Typography variant="caption" sx={{ color: 'white', fontWeight: 600 }}>
              {blockSize > 1 ? positionInBlock : index + 1}
            </Typography>
          </Tooltip>
        )}
      </Box>
    );
  }

  // Calculate seat positions based on table style
  if (table.style === 'round') {
    const radius = Math.max(table.size.width, table.size.height) / 2 + 30;
    for (let i = 0; i < table.seats; i++) {
      const angle = (i * 2 * Math.PI) / table.seats;
      const x = centerX + radius * Math.cos(angle);
      const y = centerY + radius * Math.sin(angle);
      renderSeat(i, x, y);
    }
  } else if (table.style === 'square') {
    const seatsPerSide = Math.ceil(table.seats / 4);
    const spacing = table.size.width / (seatsPerSide + 1);
    
    // Top side
    for (let i = 0; i < seatsPerSide; i++) {
      const x = spacing * (i + 1);
      const y = -30;
      renderSeat(i, x, y);
    }
    
    // Right side
    for (let i = 0; i < seatsPerSide; i++) {
      const x = table.size.width + 30;
      const y = spacing * (i + 1);
      renderSeat(seatsPerSide + i, x, y);
    }
    
    // Bottom side
    for (let i = 0; i < seatsPerSide; i++) {
      const x = table.size.width - spacing * (i + 1);
      const y = table.size.height + 30;
      renderSeat(seatsPerSide * 2 + i, x, y);
    }
    
    // Left side
    for (let i = 0; i < seatsPerSide; i++) {
      const x = -30;
      const y = table.size.height - spacing * (i + 1);
      renderSeat(seatsPerSide * 3 + i, x, y);
    }
  } else if (table.style === 'row') {
    const seatsPerRow = Math.ceil(table.seats / 2);
    const spacing = table.size.width / (seatsPerRow + 1);
    
    // Top row
    for (let i = 0; i < seatsPerRow; i++) {
      const x = spacing * (i + 1);
      const y = -30;
      renderSeat(i, x, y);
    }
    
    // Bottom row
    for (let i = 0; i < seatsPerRow; i++) {
      const x = spacing * (i + 1);
      const y = table.size.height + 30;
      renderSeat(seatsPerRow + i, x, y);
    }
  }

  return (
    <>
      <Box
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onContextMenu={handleContextMenu}
        sx={{ 
          width: table.size.width,
          height: table.size.height,
          backgroundColor: isOver ? 'action.hover' : 'background.paper',
          border: '2px solid',
          borderColor: table.side === 'bride' ? 'primary.main' : 'secondary.main',
          borderRadius: table.style === 'round' ? '50%' : 1,
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          position: 'relative',
          cursor: 'move',
          transition: 'background-color 0.2s',
        }}
      >
        <Typography variant="h6">{table.name}</Typography>
        {seats}
        <Handle type="target" position={Position.Top} />
        <Handle type="source" position={Position.Bottom} />
      </Box>
      <Menu
        open={contextMenu !== null}
        onClose={handleClose}
        anchorReference="anchorPosition"
        anchorPosition={
          contextMenu !== null
            ? { top: contextMenu.mouseY, left: contextMenu.mouseX }
            : undefined
        }
      >
        <MenuItem onClick={handleEdit}>
          <ListItemIcon>
            <EditIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>ערוך שולחן</ListItemText>
        </MenuItem>
        <MenuItem onClick={handleDelete}>
          <ListItemIcon>
            <DeleteIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>מחק שולחן</ListItemText>
        </MenuItem>
      </Menu>
    </>
  );
};

const nodeTypes: NodeTypes = {
  table: TableNode,
};

export default function Seating() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const { selectedEvent, fetchEvents } = useEvent();
  const { guests: apiGuests, loading: guestsLoading, error: guestsError, refetch: refetchGuests } = useGuests(
    1,
    2000,
    '',
    undefined,
    false
  );

  // State
  const [tables, setTables] = useState<Table[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [tableModalOpen, setTableModalOpen] = useState(false);
  const [selectedTable, setSelectedTable] = useState<Table | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [groupFilter, setGroupFilter] = useState('all');
  const [viewMode, setViewMode] = useState<'edit' | 'view'>('edit');
  const [guestSearchModalOpen, setGuestSearchModalOpen] = useState(false);
  const [selectedSeat, setSelectedSeat] = useState<{ tableId: string; seatIndex: number } | null>(null);
  const [editTableModalOpen, setEditTableModalOpen] = useState(false);
  const [guestSearchValue, setGuestSearchValue] = useState('');
  const [guestSearchResults, setGuestSearchResults] = useState<Guest[]>([]);
  const [savingGuestId, setSavingGuestId] = useState<string | null>(null);
  const [savingLayout, setSavingLayout] = useState(false);
  const [layoutSaveError, setLayoutSaveError] = useState<string | null>(null);
  const skipSyncRef = useRef(false);
  const nodesRef = useRef<Node[]>([]);

  // ReactFlow state
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  // Base tables from saved layout (seatingLayout from event)
  const baseTablesFromLayout = (): Table[] => {
    const layout = selectedEvent?.seatingLayout;
    const arr = layout?.tables;
    if (!Array.isArray(arr) || arr.length === 0) return [];
    return arr.map((t: any) => ({
      id: String(t.id),
      name: t.name || `שולחן ${t.id}`,
      seats: t.seats ?? 8,
      style: t.style || 'round',
      side: t.side || 'bride',
      position: t.position || { x: 0, y: 0 },
      size: t.size || { width: 200, height: 200 },
      seatsBride: t.seatsBride,
      seatsGroom: t.seatsGroom,
      seatAssignments: {},
    }));
  };

  // Sync guests and tables from API: layout + guests. כל אורח תופס N מושבים (guest_count ?? import_count).
  useEffect(() => {
    if (skipSyncRef.current) return;
    if (!selectedEvent?.id) {
      if (selectedEvent?.id === undefined) setTables([]);
      setGuests(apiGuests?.length ? apiGuests.map(mapGuestFromAPI) : []);
      return;
    }
    const mapped = Array.isArray(apiGuests) ? apiGuests.map(mapGuestFromAPI) : [];
    const seatCount = (g: Guest) => g.confirmedCount ?? g.expectedCount ?? 1;
    const baseTables = baseTablesFromLayout();
    const fromGuestTables = Array.from(new Set(mapped.filter((g) => g.tableNumber).map((g) => g.tableNumber!)));
    const firstIndexByTableAndGuest: Record<string, Record<string, number>> = {};
    const next: Table[] = [];

    for (const n of fromGuestTables) {
      const id = String(n);
      const atTable = mapped.filter((g) => g.tableNumber === n).sort((a, b) => a._id.localeCompare(b._id));
      const seatAssignments: Record<string, string> = {};
      firstIndexByTableAndGuest[id] = {};
      let seatIdx = 0;
      atTable.forEach((g) => {
        const nSeats = seatCount(g);
        firstIndexByTableAndGuest[id][g._id] = seatIdx;
        for (let k = 0; k < nSeats; k++) seatAssignments[String(seatIdx + k)] = g._id;
        seatIdx += nSeats;
      });
      const fromBase = baseTables.find((t) => t.id === id);
      next.push({
        id,
        name: fromBase?.name ?? `שולחן ${n}`,
        seats: fromBase?.seats ?? 8,
        style: fromBase?.style ?? 'round',
        side: fromBase?.side ?? 'bride',
        position: fromBase?.position ?? { x: 100 + (next.length + 1) * 220, y: 100 },
        size: fromBase?.size ?? { width: 200, height: 200 },
        seatsBride: fromBase?.seatsBride,
        seatsGroom: fromBase?.seatsGroom,
        seatAssignments,
      });
    }
    baseTables.forEach((t) => {
      if (!next.some((n) => n.id === t.id)) next.push({ ...t, seatAssignments: {} });
    });

    setTables(next);
    setGuests(
      mapped.map((g) => {
        if (g.tableNumber == null) return { ...g, assignedSeat: undefined };
        const firstIndex = firstIndexByTableAndGuest[String(g.tableNumber)]?.[g._id] ?? 0;
        return { ...g, assignedSeat: `${g.tableNumber}-${firstIndex}` };
      })
    );
  }, [selectedEvent?.id, JSON.stringify(selectedEvent?.seatingLayout), apiGuests]);

  // Handlers
  const handleSeatClick = useCallback((tableId: string, seatIndex: number) => {
    const table = tables.find(t => t.id === tableId);
    if (!table) return;
    
    const guestId = table.seatAssignments[seatIndex.toString()];
    const seatedGuest = guests.find(g => g._id === guestId);
    
    setSelectedTable(table);
    setSelectedSeat({ tableId, seatIndex });
    
    if (seatedGuest) {
      // If there's a seated guest, show their details
      setGuestSearchValue(seatedGuest.name);
      setGuestSearchResults([seatedGuest]);
    } else {
      // If the seat is empty, show search
      setGuestSearchValue('');
      setGuestSearchResults([]);
    }
    
    setGuestSearchModalOpen(true);
  }, [tables, guests]);

  const guestSeatCount = (g: Guest) => g.confirmedCount ?? g.expectedCount ?? 1;

  // Find first block of N consecutive free seat indices (0..seats-1)
  const findConsecutiveSeats = (table: Table, n: number): number | null => {
    for (let start = 0; start <= table.seats - n; start++) {
      let ok = true;
      for (let k = 0; k < n; k++) {
        if (table.seatAssignments[(start + k).toString()]) {
          ok = false;
          break;
        }
      }
      if (ok) return start;
    }
    return null;
  };

  // Define handleGuestDrop before using it in useEffect
  const handleGuestDrop = useCallback((guest: Guest, tableId: string) => {
    const table = tables.find(t => t.id === tableId);
    if (!table) return;

    const n = guestSeatCount(guest);
    const atTable = guests.filter(g => g.assignedSeat?.startsWith(`${tableId}-`) && g._id !== guest._id);
    const currentTaken = atTable.reduce((s, g) => s + guestSeatCount(g), 0);
    if (currentTaken + n > table.seats) return;

    const start = findConsecutiveSeats(table, n);
    if (start === null) return;

    const newAssignments: Record<string, string> = { ...table.seatAssignments };
    const prevGuestIds = new Set<string>();
    for (let k = 0; k < n; k++) {
      const prev = table.seatAssignments[String(start + k)];
      if (prev && prev !== guest._id) prevGuestIds.add(prev);
      newAssignments[String(start + k)] = guest._id;
    }
    const toUnassign = Array.from(prevGuestIds).filter((pid) => !Object.values(newAssignments).includes(pid));

    setGuests((prev) =>
      prev.map((g) => {
        if (g._id === guest._id) return { ...g, assignedSeat: `${tableId}-${start}`, tableNumber: parseInt(tableId, 10) };
        if (toUnassign.includes(g._id)) return { ...g, assignedSeat: undefined, tableNumber: undefined };
        return g;
      })
    );

    setTables(prev => prev.map(t => {
      if (t.id === tableId) return { ...t, seatAssignments: newAssignments };
      return { ...t, seatAssignments: Object.fromEntries(Object.entries(t.seatAssignments).filter(([_, id]) => id !== guest._id)) };
    }));

    const tableNum = parseInt(tableId, 10);
    if (!Number.isNaN(tableNum)) {
      setSavingGuestId(guest._id);
      fetchWithAuth(`/api/guests/${guest._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table_number: tableNum }),
      })
        .then(() => setSavingGuestId(null))
        .catch(() => setSavingGuestId(null));
    }
  }, [tables, guests]);

  // שמירת מפת השולחנות ל־API (משמש גם "שמור שינויים" וגם אחרי מחיקת שולחן)
  const saveLayoutTables = useCallback(
    async (tablesToSave: Table[]) => {
      if (!selectedEvent?.id) return;
      setSavingLayout(true);
      setLayoutSaveError(null);
      try {
        const payload = {
          seatingLayout: {
            tables: tablesToSave.map((t) => ({
              id: t.id,
              name: t.name,
              seats: t.seats,
              style: t.style,
              side: t.side,
              position: t.position,
              size: t.size,
              ...(t.seatsBride != null && { seatsBride: t.seatsBride }),
              ...(t.seatsGroom != null && { seatsGroom: t.seatsGroom }),
            })),
          },
        };
        const res = await fetchWithAuth(`/api/events/${selectedEvent.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(await res.text());
        await fetchEvents();
        // רענון אורחים כדי שה-sync יציג מיד את מיקומי האורחים בלי ריענון דף
        if (refetchGuests) await refetchGuests();
      } catch (e: any) {
        setLayoutSaveError(e?.message || 'שמירת המפה נכשלה');
      } finally {
        setSavingLayout(false);
      }
    },
    [selectedEvent?.id, fetchEvents, refetchGuests]
  );

  const handleSaveLayout = useCallback(async () => {
    await saveLayoutTables(tables);
  }, [saveLayoutTables, tables]);

  // בטל: טוען מחדש מהשרת ומבטל שינויים שלא נשמרו
  const handleCancelLayout = useCallback(async () => {
    setLayoutSaveError(null);
    try {
      await fetchEvents();
      if (refetchGuests) await refetchGuests();
    } catch (e: any) {
      setLayoutSaveError(e?.message || 'ביטול שינויים נכשל');
    }
  }, [fetchEvents, refetchGuests]);

  // מחיקת שולחן: שחרור אורחים ב-API, דילוג על sync כדי שלא יחזיר את השולחן, עדכון state, שמירת מפה
  const handleDeleteTable = useCallback(
    async (tableId: string) => {
      const guestIdsAtTable = guests
        .filter((g) => g.tableNumber != null && String(g.tableNumber) === tableId)
        .map((g) => g._id);
      try {
        await Promise.all(
          guestIdsAtTable.map(async (id) => {
            const res = await fetchWithAuth(`/api/guests/${id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ table_number: null }),
            });
            if (!res.ok) throw new Error(await res.text());
          })
        );
      } catch (e: any) {
        setLayoutSaveError(e?.message || 'שחרור אורחים נכשל');
        return;
      }
      skipSyncRef.current = true;
      try {
        if (refetchGuests) await refetchGuests();
        const newTables = tables.filter((t) => t.id !== tableId);
        setTables(newTables);
        setGuests((prev) =>
          prev.map((g) =>
            guestIdsAtTable.includes(g._id)
              ? { ...g, assignedSeat: undefined, tableNumber: undefined }
              : g
          )
        );
        await saveLayoutTables(newTables);
      } finally {
        skipSyncRef.current = false;
      }
    },
    [guests, tables, saveLayoutTables, refetchGuests]
  );

  // מחיקת כמה שולחנות (משמש מקש Delete/Backspace)
  const handleDeleteTables = useCallback(
    async (tableIds: string[]) => {
      if (tableIds.length === 0) return;
      const guestIdsToRelease = guests
        .filter((g) => g.tableNumber != null && tableIds.includes(String(g.tableNumber)))
        .map((g) => g._id);
      try {
        await Promise.all(
          guestIdsToRelease.map(async (id) => {
            const res = await fetchWithAuth(`/api/guests/${id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ table_number: null }),
            });
            if (!res.ok) throw new Error(await res.text());
          })
        );
      } catch (e: any) {
        setLayoutSaveError(e?.message || 'שחרור אורחים נכשל');
        return;
      }
      skipSyncRef.current = true;
      try {
        if (refetchGuests) await refetchGuests();
        const idSet = new Set(tableIds);
        const newTables = tables.filter((t) => !idSet.has(t.id));
        setTables(newTables);
        setGuests((prev) =>
          prev.map((g) =>
            guestIdsToRelease.includes(g._id)
              ? { ...g, assignedSeat: undefined, tableNumber: undefined }
              : g
          )
        );
        await saveLayoutTables(newTables);
      } finally {
        skipSyncRef.current = false;
      }
    },
    [guests, tables, saveLayoutTables, refetchGuests]
  );

  // Update the useEffect for nodes – שומר selected מ־nodes הקודמים
  useEffect(() => {
    setNodes((prevNodes) =>
      tables.map((table) => {
        const prev = prevNodes.find((n) => n.id === table.id);
        return {
          id: table.id,
          type: 'table',
          position: table.position,
          selected: prev?.selected ?? false,
          selectable: true,
          data: {
            table,
            guests,
            onSeatClick: handleSeatClick,
            onTableEdit: (t: Table) => {
              setSelectedTable(t);
              setEditTableModalOpen(true);
            },
            onTableDelete: handleDeleteTable,
            onGuestDrop: handleGuestDrop,
          },
        };
      })
    );
  }, [tables, guests, handleSeatClick, handleGuestDrop, handleDeleteTable]);

  // עדכון ref ל-nodes (למקשי קיצור)
  nodesRef.current = nodes;

  // מקשי קיצור: Ctrl/Cmd+A בחירת כל השולחנות, Backspace/Delete מחיקת נבחרים
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setNodes((prev) => prev.map((n) => ({ ...n, selected: true })));
        return;
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        const selectedIds = nodesRef.current.filter((n) => n.selected).map((n) => n.id);
        if (selectedIds.length > 0) {
          e.preventDefault();
          handleDeleteTables(selectedIds);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleDeleteTables]);

  // Filtered guests
  const filteredGuests = guests.filter(guest => {
    const matchesSearch = guest.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || guest.status === statusFilter;
    const matchesGroup = groupFilter === 'all' || guest.group === groupFilter;
    return matchesSearch && matchesStatus && matchesGroup;
  });

  // Unseated guests
  const unseatedGuests = filteredGuests.filter(guest => !guest.assignedSeat);

  // Handle node position changes
  const onNodeDragStop = useCallback((event: React.MouseEvent, node: Node) => {
    setTables(prev => prev.map(t => 
      t.id === node.id 
        ? { ...t, position: { x: node.position.x, y: node.position.y } }
        : t
    ));
  }, []);

  // במובייל: לחיצה על שולחן פותחת את עריכת השולחן (הוספת אורחים וכו')
  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (!isMobile) return;
      const table = tables.find((t) => t.id === node.id);
      if (table) {
        setSelectedTable(table);
        setEditTableModalOpen(true);
      }
    },
    [isMobile, tables]
  );

  const nextTableId = () => {
    const fromTables = tables.map(t => parseInt(t.id, 10)).filter(n => !Number.isNaN(n));
    const fromGuests = guests.filter(g => g.tableNumber != null).map(g => g.tableNumber!);
    const max = Math.max(0, ...fromTables, ...fromGuests);
    return String(max + 1);
  };

  const handleAddTable = () => {
    const id = nextTableId();
    setSelectedTable({
      id,
      name: `שולחן ${id}`,
      seats: 8,
      style: 'round',
      side: 'bride',
      position: { x: 100 + tables.length * 220, y: 100 },
      size: { width: 200, height: 200 },
      seatAssignments: {}
    });
    setTableModalOpen(true);
  };

  const handleEditTable = (table: Table) => {
    setSelectedTable(table);
    setTableModalOpen(true);
  };

  const handleSaveTable = (tableData: Partial<Table>) => {
    if (!selectedTable) return;

    const updatedTable = {
      ...selectedTable,
      ...tableData,
      size: selectedTable.size // Preserve the size that was calculated during editing
    };

    if (tables.some(t => t.id === selectedTable.id)) {
      // Update existing table
      setTables(prev => prev.map(t => 
        t.id === selectedTable.id ? updatedTable : t
      ));
    } else {
      // Add new table
      setTables(prev => [...prev, updatedTable]);
    }
    
    setTableModalOpen(false);
    setSelectedTable(null);
  };

  const handleAssignGuestToSeat = (guest: Guest, seatIndex?: number) => {
    if (!selectedTable) return;

    const n = guestSeatCount(guest);
    const atTable = guests.filter(g => g.assignedSeat?.startsWith(`${selectedTable.id}-`) && g._id !== guest._id);
    const currentTaken = atTable.reduce((s, g) => s + guestSeatCount(g), 0);
    if (currentTaken + n > selectedTable.seats) return;

    const start = seatIndex != null ? seatIndex : findConsecutiveSeats(selectedTable, n);
    if (start === null || (seatIndex != null && seatIndex + n > selectedTable.seats)) return;

    const newAssignments: Record<string, string> = {
      ...Object.fromEntries(Object.entries(selectedTable.seatAssignments).filter(([_, id]) => id !== guest._id)),
    };
    const prevGuestIds = new Set<string>();
    for (let k = 0; k < n; k++) {
      const prev = selectedTable.seatAssignments[String(start + k)];
      if (prev && prev !== guest._id) prevGuestIds.add(prev);
      newAssignments[String(start + k)] = guest._id;
    }
    const toUnassign = Array.from(prevGuestIds).filter((pid) => !Object.values(newAssignments).includes(pid));

    const updatedTable = { ...selectedTable, seatAssignments: newAssignments };

    setGuests((prev) =>
      prev.map((g) => {
        if (g._id === guest._id) return { ...g, assignedSeat: `${selectedTable.id}-${start}`, tableNumber: parseInt(selectedTable.id, 10) };
        if (toUnassign.includes(g._id)) return { ...g, assignedSeat: undefined, tableNumber: undefined };
        return g;
      })
    );
    setTables(prev => prev.map(t =>
      t.id === selectedTable.id ? updatedTable : { ...t, seatAssignments: Object.fromEntries(Object.entries(t.seatAssignments).filter(([_, id]) => id !== guest._id)) }
    ));
    setSelectedTable(updatedTable);
    setGuestSearchValue('');
    setGuestSearchResults([]);

    const tableNum = parseInt(selectedTable.id, 10);
    if (!Number.isNaN(tableNum)) {
      setSavingGuestId(guest._id);
      fetchWithAuth(`/api/guests/${guest._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table_number: tableNum }),
      })
        .then(() => setSavingGuestId(null))
        .catch(() => setSavingGuestId(null));
    }
  };

  const handleRemoveGuestFromSeat = (guestId: string, tableId: string, _seatIndex: string) => {
    setGuests(prev => prev.map(g =>
      g._id === guestId ? { ...g, assignedSeat: undefined, tableNumber: undefined } : g
    ));
    setTables(prev => prev.map(t =>
      t.id === tableId
        ? { ...t, seatAssignments: Object.fromEntries(Object.entries(t.seatAssignments).filter(([_, id]) => id !== guestId)) }
        : t
    ));
    if (selectedTable?.id === tableId) {
      setSelectedTable(prev => prev ? { ...prev, seatAssignments: Object.fromEntries(Object.entries(prev.seatAssignments).filter(([_, id]) => id !== guestId)) } : null);
    }
    setSavingGuestId(guestId);
    fetchWithAuth(`/api/guests/${guestId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table_number: null }),
    })
      .then(() => setSavingGuestId(null))
      .catch(() => setSavingGuestId(null));
  };

  // Handle guest search
  const handleGuestSearch = (value: string) => {
    setGuestSearchValue(value);
    if (value) {
      const results = guests.filter(guest => 
        guest.name.toLowerCase().includes(value.toLowerCase()) &&
        !guest.assignedSeat
      );
      setGuestSearchResults(results);
    } else {
      setGuestSearchResults([]);
    }
  };

  const handleExportPDF = () => {
    // TODO: Implement PDF export
    console.log('Exporting to PDF...');
  };

  if (!selectedEvent) {
    return (
      <Box sx={{ p: 2, display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 200 }}>
        <Typography color="text.secondary">בחר אירוע כדי לראות סידור מושבים</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ 
      position: 'relative',
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column'
    }}>
      {/* Canvas Area - Fill Available Space */}
      <Box sx={{ 
        flex: 1,
        position: 'relative',
        backgroundColor: 'background.default',
        minHeight: 0
      }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStop={onNodeDragStop}
          onNodeClick={onNodeClick}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{
            padding: 1.2,
            minZoom: 0.3,
            maxZoom: 2
          }}
          style={{ width: '100%', height: '100%' }}
        >
          <Background />
          <Controls />
        </ReactFlow>
      </Box>

      {/* Overlay Controls – ריווח ו־nowrap אחידים במובייל */}
      <Box sx={{
        position: 'absolute',
        top: 16,
        left: 16,
        zIndex: 1000,
        backgroundColor: alpha(theme.palette.background.paper, 0.9),
        backdropFilter: 'blur(8px)',
        borderRadius: 2,
        boxShadow: `0 4px 20px ${alpha('#000', 0.1)}`,
        p: { xs: 1.5, sm: 1 },
        maxWidth: { xs: 'calc(100vw - 32px)', sm: 'none' },
      }}>
        {layoutSaveError && (
          <Alert severity="error" onClose={() => setLayoutSaveError(null)} sx={{ mb: 1 }}>
            {layoutSaveError}
          </Alert>
        )}
        <Stack
          direction="row"
          flexWrap="wrap"
          spacing={1.5}
          alignItems="center"
          useFlexGap
          sx={{
            '& .MuiButton-root': {
              gap: { xs: 0.5, sm: 0.75 },
              whiteSpace: 'nowrap',
              flexShrink: 0,
              minHeight: { xs: 36, sm: undefined },
              py: { xs: 0.5, sm: undefined },
              px: { xs: 1, sm: undefined },
              fontSize: { xs: '0.8125rem', sm: undefined },
            },
            '& .MuiButton-startIcon svg': { width: { xs: 18, sm: 20 }, height: { xs: 18, sm: 20 } },
          }}
        >
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={handleAddTable}
            size="small"
          >
            הוסף
          </Button>
          <Button
            variant="contained"
            startIcon={savingLayout ? <CircularProgress size={18} color="inherit" /> : <SaveIcon />}
            onClick={handleSaveLayout}
            disabled={savingLayout}
            size="small"
          >
            {savingLayout ? 'שומר...' : 'שמור'}
          </Button>
          <Button
            variant="outlined"
            startIcon={<CancelIcon />}
            onClick={handleCancelLayout}
            size="small"
          >
            בטל
          </Button>
          <Button
            variant="outlined"
            startIcon={<PictureAsPdfIcon />}
            onClick={handleExportPDF}
            size="small"
          >
            ייצוא ל-PDF
          </Button>
        </Stack>
      </Box>

      {/* Sidebar - Overlay (מוסתר במובייל; הוספת אורחים דרך לחיצה על שולחן) */}
      {!isMobile ? (
      <Paper sx={{ 
        position: 'absolute',
        top: 16, // Align with top controls
        right: 16,
        width: 300,
        p: 2,
        zIndex: 1000,
        backgroundColor: alpha(theme.palette.background.paper, 0.9),
        backdropFilter: 'blur(8px)',
        borderRadius: 2,
        boxShadow: `0 4px 20px ${alpha('#000', 0.1)}`,
        maxHeight: 'calc(100% - 32px)', // Account for top margin
        display: 'flex',
        flexDirection: 'column'
      }}>
        <Stack spacing={2} sx={{ flex: 1, minHeight: 0 }}>
          <TextField
            fullWidth
            placeholder="חיפוש אורחים..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon />
                </InputAdornment>
              ),
            }}
            size="small"
          />
          
          <FormControl fullWidth size="small">
            <InputLabel>סטטוס</InputLabel>
            <Select
              value={statusFilter}
              label="סטטוס"
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <MenuItem value="all">הכל</MenuItem>
              {Object.entries(statusLabels).map(([value, label]) => (
                <MenuItem key={value} value={value}>{label}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl fullWidth size="small">
            <InputLabel>קבוצה</InputLabel>
            <Select
              value={groupFilter}
              label="קבוצה"
              onChange={(e) => setGroupFilter(e.target.value)}
            >
              <MenuItem value="all">הכל</MenuItem>
              {Array.from(new Set(guests.map(g => g.group).filter((g): g is string => Boolean(g)))).sort().map(gr => (
                <MenuItem key={gr} value={gr}>{gr}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <Divider />

          {guestsError && (
            <Alert severity="error" sx={{ py: 0 }} onClose={() => {}}>
              {guestsError}
            </Alert>
          )}
          {guestsLoading && guests.length === 0 && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1 }}>
              <CircularProgress size={20} />
              <Typography variant="body2" color="text.secondary">טוען אורחים...</Typography>
            </Box>
          )}
          <Typography variant="subtitle2">אורחים ללא מקום ישיבה</Typography>
          
          <Box sx={{ 
            maxHeight: 320,
            overflowY: 'auto',
            overflowX: 'hidden',
            minHeight: 0
          }}>
            {unseatedGuests.map((guest) => (
              <DraggableGuest key={guest._id} guest={guest} />
            ))}
          </Box>
        </Stack>
      </Paper>
      ) : null}

      {/* Add/Edit Table Modal */}
      <Dialog
        open={tableModalOpen}
        onClose={() => {
          setTableModalOpen(false);
          setSelectedTable(null);
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          {selectedTable?.id ? 'עריכת שולחן' : 'הוספת שולחן חדש'}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 2 }}>
            <TextField
              fullWidth
              label="שם השולחן"
              value={selectedTable?.name || ''}
              onChange={(e) => setSelectedTable(prev => prev ? { ...prev, name: e.target.value } : null)}
            />
            <TextField
              fullWidth
              type="number"
              label="סה״כ מקומות"
              value={selectedTable?.seats ?? 8}
              inputProps={{ min: 1, max: 40 }}
              onChange={(e) => {
                const v = e.target.value;
                const seats = v === '' ? 8 : parseInt(v, 10) || 8;
                const style = selectedTable?.style || 'round';
                let size = { width: 200, height: 200 };
                if (style === 'row') {
                  const seatsPerRow = Math.ceil(seats / 2);
                  size = { width: Math.max(300, seatsPerRow * 60), height: 150 };
                } else if (style === 'square') {
                  const seatsPerSide = Math.ceil(seats / 4);
                  const minSize = Math.max(200, seatsPerSide * 60);
                  size = { width: minSize, height: minSize };
                }
                setSelectedTable(prev => prev ? { ...prev, seats, size, seatsBride: undefined, seatsGroom: undefined } : null);
              }}
            />
            <Typography variant="caption" color="text.secondary">
              פירוט לפי צד (אופציונלי – לשולחן מעורב)
            </Typography>
            <Stack direction="row" spacing={2}>
              <TextField
                fullWidth
                type="number"
                label="מקומות צד כלה"
                value={selectedTable?.seatsBride ?? ''}
                inputProps={{ min: 0, max: 20 }}
                placeholder="—"
                onChange={(e) => {
                  const v = e.target.value;
                  const bride = v === '' ? undefined : parseInt(v, 10);
                  const groom = selectedTable?.seatsGroom;
                  const seats = (bride != null && groom != null) ? bride + groom : (selectedTable?.seats ?? 8);
                  const style = selectedTable?.style || 'round';
                  let size = { width: 200, height: 200 };
                  if (style === 'row') size = { width: Math.max(300, Math.ceil(seats / 2) * 60), height: 150 };
                  else if (style === 'square') { const sp = Math.ceil(seats / 4); size = { width: Math.max(200, sp * 60), height: Math.max(200, sp * 60) }; }
                  setSelectedTable(prev => prev ? { ...prev, seatsBride: bride, seatsGroom: groom, seats, size } : null);
                }}
              />
              <TextField
                fullWidth
                type="number"
                label="מקומות צד חתן"
                value={selectedTable?.seatsGroom ?? ''}
                inputProps={{ min: 0, max: 20 }}
                placeholder="—"
                onChange={(e) => {
                  const v = e.target.value;
                  const groom = v === '' ? undefined : parseInt(v, 10);
                  const bride = selectedTable?.seatsBride;
                  const seats = (bride != null && groom != null) ? bride + groom : (selectedTable?.seats ?? 8);
                  const style = selectedTable?.style || 'round';
                  let size = { width: 200, height: 200 };
                  if (style === 'row') size = { width: Math.max(300, Math.ceil(seats / 2) * 60), height: 150 };
                  else if (style === 'square') { const sp = Math.ceil(seats / 4); size = { width: Math.max(200, sp * 60), height: Math.max(200, sp * 60) }; }
                  setSelectedTable(prev => prev ? { ...prev, seatsBride: bride, seatsGroom: groom, seats, size } : null);
                }}
              />
            </Stack>
            <FormControl fullWidth>
              <InputLabel>סגנון ישיבה</InputLabel>
              <Select
                value={selectedTable?.style || 'round'}
                label="סגנון ישיבה"
                onChange={(e) => {
                  const style = e.target.value as 'round' | 'row' | 'square';
                  const seats = selectedTable?.seats || 8;
                  let size = { width: 200, height: 200 };
                  
                  if (style === 'row') {
                    const seatsPerRow = Math.ceil(seats / 2);
                    size = {
                      width: Math.max(300, seatsPerRow * 60),
                      height: 150
                    };
                  } else if (style === 'square') {
                    const seatsPerSide = Math.ceil(seats / 4);
                    const minSize = Math.max(200, seatsPerSide * 60);
                    size = {
                      width: minSize,
                      height: minSize
                    };
                  }

                  setSelectedTable(prev => prev ? { ...prev, style, size } : null);
                }}
              >
                <MenuItem value="round">עגול</MenuItem>
                <MenuItem value="row">שורה</MenuItem>
                <MenuItem value="square">ריבוע</MenuItem>
              </Select>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel>צד</InputLabel>
              <Select
                value={selectedTable?.side || 'bride'}
                label="צד"
                onChange={(e) => setSelectedTable(prev => prev ? { ...prev, side: e.target.value as 'bride' | 'groom' } : null)}
              >
                <MenuItem value="bride">כלה</MenuItem>
                <MenuItem value="groom">חתן</MenuItem>
              </Select>
            </FormControl>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => {
            setTableModalOpen(false);
            setSelectedTable(null);
          }}>ביטול</Button>
          <Button variant="contained" onClick={() => handleSaveTable(selectedTable || {})}>
            שמירה
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit Table Modal */}
      <Dialog
        open={editTableModalOpen}
        onClose={() => {
          setEditTableModalOpen(false);
          setSelectedTable(null);
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>עריכת שולחן</DialogTitle>
        <DialogContent>
          <Stack spacing={3} sx={{ mt: 2 }}>
            <TextField
              fullWidth
              label="שם השולחן"
              value={selectedTable?.name || ''}
              onChange={(e) => setSelectedTable(prev => prev ? { ...prev, name: e.target.value } : null)}
            />
            <FormControl fullWidth>
              <InputLabel>צד</InputLabel>
              <Select
                value={selectedTable?.side || 'bride'}
                label="צד"
                onChange={(e) => setSelectedTable(prev => prev ? { ...prev, side: e.target.value as 'bride' | 'groom' } : null)}
              >
                <MenuItem value="bride">כלה</MenuItem>
                <MenuItem value="groom">חתן</MenuItem>
              </Select>
            </FormControl>

            <Box>
              <Typography variant="subtitle1" gutterBottom>
                הוסף אורחים
              </Typography>
              <Autocomplete
                freeSolo
                options={guestSearchResults}
                getOptionLabel={(option) => 
                  typeof option === 'string' ? option : option.name
                }
                inputValue={guestSearchValue}
                onInputChange={(_, value) => handleGuestSearch(value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && guestSearchResults.length > 0) {
                    handleAssignGuestToSeat(guestSearchResults[0]);
                    setGuestSearchValue('');
                    setGuestSearchResults([]);
                  }
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    fullWidth
                    placeholder="חיפוש אורחים..."
                    size="small"
                  />
                )}
                renderOption={(props, option) => (
                  <Box component="li" {...props}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography>{option.name}</Typography>
                      <Typography variant="body2" color="text.secondary">
                        {option.group}
                      </Typography>
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAssignGuestToSeat(option);
                        }}
                      >
                        <PersonAddIcon />
                      </IconButton>
                    </Box>
                  </Box>
                )}
              />
            </Box>

            <Box>
              <Typography variant="subtitle1" gutterBottom>
                אורחים בשולחן
              </Typography>
              <List>
                {selectedTable && Array.from({ length: selectedTable.seats }).map((_, index) => {
                  const seatIndex = index.toString();
                  const guestId = selectedTable.seatAssignments[seatIndex];
                  const guest = guests.find(g => g._id === guestId);
                  
                  return (
                    <ListItem
                      key={seatIndex}
                      secondaryAction={
                        guest && (
                          <IconButton
                            edge="end"
                            onClick={() => handleRemoveGuestFromSeat(guestId, selectedTable.id, seatIndex)}
                          >
                            <DeleteIcon />
                          </IconButton>
                        )
                      }
                    >
                      <ListItemText
                        primary={guest ? guest.name : `מושב ${index + 1} - פנוי`}
                        secondary={guest ? guest.group : ''}
                        sx={{
                          color: guest ? 'text.primary' : 'text.secondary'
                        }}
                      />
                    </ListItem>
                  );
                })}
              </List>
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => {
            setEditTableModalOpen(false);
            setSelectedTable(null);
          }}>
            ביטול
          </Button>
          <Button
            variant="contained"
            onClick={() => {
              if (selectedTable) {
                setTables(prev => prev.map(t => 
                  t.id === selectedTable.id ? selectedTable : t
                ));
              }
              setEditTableModalOpen(false);
              setSelectedTable(null);
            }}
          >
            שמירה
          </Button>
        </DialogActions>
      </Dialog>

      {/* Guest Search – במובייל: Drawer מלמטה (המפה נשארת גלויה), בדסקטופ: Dialog */}
      {isMobile ? (
        <Drawer
          anchor="bottom"
          open={guestSearchModalOpen}
          onClose={() => {
            setGuestSearchModalOpen(false);
            setSelectedSeat(null);
          }}
          PaperProps={{
            sx: {
              maxHeight: '65vh',
              borderTopLeftRadius: 16,
              borderTopRightRadius: 16,
            },
          }}
        >
          <Box sx={{ pt: 1.5, pb: 2, px: 2 }}>
            <Box sx={{ width: 40, height: 4, borderRadius: 2, bgcolor: 'grey.300', mx: 'auto', mb: 2 }} />
            <Typography variant="h6" gutterBottom>בחר אורח</Typography>
            {selectedSeat && tables.find(t => t.id === selectedSeat.tableId)?.seatAssignments[selectedSeat.seatIndex.toString()] ? (
              <Box sx={{ mt: 2 }}>
                <Typography variant="subtitle1" gutterBottom>אורח ממושב זה:</Typography>
                <Paper sx={{ p: 2, mb: 2 }}>
                  <Stack spacing={1}>
                    <Typography variant="body1">
                      {guests.find(g => g._id === tables.find(t => t.id === selectedSeat.tableId)?.seatAssignments[selectedSeat.seatIndex.toString()])?.name}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {guests.find(g => g._id === tables.find(t => t.id === selectedSeat.tableId)?.seatAssignments[selectedSeat.seatIndex.toString()])?.group}
                    </Typography>
                    <Chip
                      label={statusLabels[guests.find(g => g._id === tables.find(t => t.id === selectedSeat.tableId)?.seatAssignments[selectedSeat.seatIndex.toString()])?.status || 'pending']}
                      size="small"
                      sx={{
                        backgroundColor: `${statusColors[guests.find(g => g._id === tables.find(t => t.id === selectedSeat.tableId)?.seatAssignments[selectedSeat.seatIndex.toString()])?.status || 'pending']}20`,
                        color: statusColors[guests.find(g => g._id === tables.find(t => t.id === selectedSeat.tableId)?.seatAssignments[selectedSeat.seatIndex.toString()])?.status || 'pending'],
                      }}
                    />
                  </Stack>
                </Paper>
                <Stack direction="row" spacing={2}>
                  <Button variant="outlined" color="error" onClick={() => {
                    if (selectedSeat) {
                      const guestId = tables.find(t => t.id === selectedSeat.tableId)?.seatAssignments[selectedSeat.seatIndex.toString()];
                      if (guestId) handleRemoveGuestFromSeat(guestId, selectedSeat.tableId, selectedSeat.seatIndex.toString());
                    }
                    setGuestSearchModalOpen(false);
                    setSelectedSeat(null);
                  }}>הסר אורח</Button>
                  <Button variant="outlined" onClick={() => { setGuestSearchValue(''); setGuestSearchResults([]); }}>החלף אורח</Button>
                </Stack>
              </Box>
            ) : (
              <>
                <TextField fullWidth placeholder="חיפוש אורחים..." value={guestSearchValue} onChange={(e) => handleGuestSearch(e.target.value)} onKeyDown={(e) => {
                  if (e.key === 'Enter' && guestSearchResults.length > 0) {
                    handleAssignGuestToSeat(guestSearchResults[0], selectedSeat?.seatIndex);
                    setGuestSearchModalOpen(false);
                    setSelectedSeat(null);
                  }
                }} sx={{ mt: 2 }} />
                <List sx={{ maxHeight: 200, overflowY: 'auto' }}>
                  {guestSearchResults.map(guest => (
                    <ListItem key={guest._id} button onClick={() => {
                      if (selectedSeat) handleAssignGuestToSeat(guest, selectedSeat.seatIndex);
                      setGuestSearchModalOpen(false);
                      setSelectedSeat(null);
                    }}>
                      <ListItemText primary={guest.name} secondary={guest.group} />
                      <Chip label={statusLabels[guest.status]} size="small" sx={{ backgroundColor: `${statusColors[guest.status]}20`, color: statusColors[guest.status] }} />
                    </ListItem>
                  ))}
                </List>
              </>
            )}
            <Button fullWidth variant="outlined" onClick={() => { setGuestSearchModalOpen(false); setSelectedSeat(null); }} sx={{ mt: 2 }}>ביטול</Button>
          </Box>
        </Drawer>
      ) : (
        <Dialog open={guestSearchModalOpen} onClose={() => { setGuestSearchModalOpen(false); setSelectedSeat(null); }} maxWidth="sm" fullWidth>
          <DialogTitle>בחר אורח</DialogTitle>
          <DialogContent>
            {selectedSeat && tables.find(t => t.id === selectedSeat.tableId)?.seatAssignments[selectedSeat.seatIndex.toString()] ? (
              <Box sx={{ mt: 2 }}>
                <Typography variant="subtitle1" gutterBottom>אורח ממושב זה:</Typography>
                <Paper sx={{ p: 2, mb: 2 }}>
                  <Stack spacing={1}>
                    <Typography variant="body1">
                      {guests.find(g => g._id === tables.find(t => t.id === selectedSeat.tableId)?.seatAssignments[selectedSeat.seatIndex.toString()])?.name}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {guests.find(g => g._id === tables.find(t => t.id === selectedSeat.tableId)?.seatAssignments[selectedSeat.seatIndex.toString()])?.group}
                    </Typography>
                    <Chip label={statusLabels[guests.find(g => g._id === tables.find(t => t.id === selectedSeat.tableId)?.seatAssignments[selectedSeat.seatIndex.toString()])?.status || 'pending']} size="small" sx={{ backgroundColor: `${statusColors[guests.find(g => g._id === tables.find(t => t.id === selectedSeat.tableId)?.seatAssignments[selectedSeat.seatIndex.toString()])?.status || 'pending']}20`, color: statusColors[guests.find(g => g._id === tables.find(t => t.id === selectedSeat.tableId)?.seatAssignments[selectedSeat.seatIndex.toString()])?.status || 'pending'] }} />
                  </Stack>
                </Paper>
                <Stack direction="row" spacing={2}>
                  <Button variant="outlined" color="error" onClick={() => {
                    if (selectedSeat) {
                      const guestId = tables.find(t => t.id === selectedSeat.tableId)?.seatAssignments[selectedSeat.seatIndex.toString()];
                      if (guestId) handleRemoveGuestFromSeat(guestId, selectedSeat.tableId, selectedSeat.seatIndex.toString());
                    }
                    setGuestSearchModalOpen(false);
                    setSelectedSeat(null);
                  }}>הסר אורח</Button>
                  <Button variant="outlined" onClick={() => { setGuestSearchValue(''); setGuestSearchResults([]); }}>החלף אורח</Button>
                </Stack>
              </Box>
            ) : (
              <>
                <TextField fullWidth placeholder="חיפוש אורחים..." value={guestSearchValue} onChange={(e) => handleGuestSearch(e.target.value)} onKeyDown={(e) => {
                  if (e.key === 'Enter' && guestSearchResults.length > 0) {
                    handleAssignGuestToSeat(guestSearchResults[0], selectedSeat?.seatIndex);
                    setGuestSearchModalOpen(false);
                    setSelectedSeat(null);
                  }
                }} sx={{ mt: 2 }} />
                <List>
                  {guestSearchResults.map(guest => (
                    <ListItem key={guest._id} button onClick={() => {
                      if (selectedSeat) handleAssignGuestToSeat(guest, selectedSeat.seatIndex);
                      setGuestSearchModalOpen(false);
                      setSelectedSeat(null);
                    }}>
                      <ListItemText primary={guest.name} secondary={guest.group} />
                      <Chip label={statusLabels[guest.status]} size="small" sx={{ backgroundColor: `${statusColors[guest.status]}20`, color: statusColors[guest.status] }} />
                    </ListItem>
                  ))}
                </List>
              </>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => { setGuestSearchModalOpen(false); setSelectedSeat(null); }}>ביטול</Button>
          </DialogActions>
        </Dialog>
      )}
    </Box>
  );
}