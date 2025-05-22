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
import { Guest, Table, mockGuests, mockTables, statusColors, statusLabels } from '../mocks/guestData';

// Update DraggableGuest component
const DraggableGuest = ({ guest }: { guest: Guest }) => {
  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('guest', JSON.stringify(guest));
  };

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
            <Typography variant="body1">{guest.name}</Typography>
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

  function renderSeat(index: number, x: number, y: number) {
    const assignedGuest = guests.find((g: Guest) => g.assignedSeat === `${table.id}-${index.toString()}`);
    
    seats.push(
      <Box
        key={index}
        onClick={() => onSeatClick(table.id, index)}
        sx={{
          position: 'absolute',
          left: x - 15,
          top: y - 15,
          width: 30,
          height: 30,
          borderRadius: '50%',
          backgroundColor: assignedGuest ? statusColors[assignedGuest.status as keyof typeof statusColors] : 'white',
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
          <Tooltip title={assignedGuest.name}>
            <Typography variant="caption" sx={{ color: 'white' }}>
              {index + 1}
            </Typography>
          </Tooltip>
        )}
      </Box>
    );
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
          backgroundColor: isOver ? 'action.hover' : 'white',
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
  
  // State
  const [tables, setTables] = useState<Table[]>(mockTables);
  const [guests, setGuests] = useState<Guest[]>(mockGuests);
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

  // ReactFlow state
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

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

  // Define handleGuestDrop before using it in useEffect
  const handleGuestDrop = useCallback((guest: Guest, tableId: string) => {
    const table = tables.find(t => t.id === tableId);
    if (!table) return;

    // Find first available seat
    const availableSeatIndex = Object.entries(table.seatAssignments)
      .find(([_, guestId]) => !guestId)?.[0] ?? 
      Object.keys(table.seatAssignments).length.toString();

    // Remove previous assignment if exists
    setGuests(prev => prev.map(g => 
      g.assignedSeat === `${tableId}-${availableSeatIndex}`
        ? { ...g, assignedSeat: undefined }
        : g
    ));

    // Add new assignment
    setGuests(prev => prev.map(g => 
      g._id === guest._id
        ? { ...g, assignedSeat: `${tableId}-${availableSeatIndex}` }
        : g
    ));

    // Update table assignments
    setTables(prev => prev.map(t => 
      t.id === tableId
        ? {
            ...t,
            seatAssignments: {
              ...t.seatAssignments,
              [availableSeatIndex]: guest._id
            }
          }
        : t
    ));
  }, [tables]);

  // Update the useEffect for nodes
  useEffect(() => {
    const newNodes = tables.map(table => ({
      id: table.id,
      type: 'table',
      position: table.position,
      data: { 
        table, 
        guests, 
        onSeatClick: handleSeatClick,
        onTableEdit: (table: Table) => {
          setSelectedTable(table);
          setEditTableModalOpen(true);
        },
        onTableDelete: (tableId: string) => {
          setTables(prev => prev.filter(t => t.id !== tableId));
        },
        onGuestDrop: handleGuestDrop
      },
    }));
    setNodes(newNodes);
  }, [tables, guests, handleSeatClick, handleGuestDrop]);

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

  // Handlers
  const handleAddTable = () => {
    setSelectedTable({
      id: Date.now().toString(),
      name: 'שולחן חדש',
      seats: 8,
      style: 'round',
      side: 'bride',
      position: { x: 100, y: 100 },
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

    // If seatIndex is provided, use it. Otherwise find first available seat
    const targetSeatIndex = seatIndex ?? 
      Object.entries(selectedTable.seatAssignments)
        .find(([_, guestId]) => !guestId)?.[0] ?? 
      Object.keys(selectedTable.seatAssignments).length.toString();

    // Remove previous assignment if exists
    setGuests(prev => prev.map(g => 
      g.assignedSeat === `${selectedTable.id}-${targetSeatIndex}`
        ? { ...g, assignedSeat: undefined }
        : g
    ));

    // Add new assignment
    setGuests(prev => prev.map(g => 
      g._id === guest._id
        ? { ...g, assignedSeat: `${selectedTable.id}-${targetSeatIndex}` }
        : g
    ));

    // Update table assignments
    const updatedTable = {
      ...selectedTable,
      seatAssignments: {
        ...selectedTable.seatAssignments,
        [targetSeatIndex]: guest._id
      }
    };

    setTables(prev => prev.map(t => 
      t.id === selectedTable.id ? updatedTable : t
    ));

    // Update selected table if it's being edited
    setSelectedTable(updatedTable);

    setGuestSearchValue('');
    setGuestSearchResults([]);
  };

  // Add a new function to handle guest removal
  const handleRemoveGuestFromSeat = (guestId: string, tableId: string, seatIndex: string) => {
    // Update guests state
    setGuests(prev => prev.map(g => 
      g._id === guestId
        ? { ...g, assignedSeat: undefined }
        : g
    ));

    // Update tables state
    setTables(prev => prev.map(t => 
      t.id === tableId
        ? {
            ...t,
            seatAssignments: Object.fromEntries(
              Object.entries(t.seatAssignments)
                .filter(([key]) => key !== seatIndex)
            )
          }
        : t
    ));

    // Update selected table if it's the one being edited
    if (selectedTable?.id === tableId) {
      setSelectedTable(prev => prev ? {
        ...prev,
        seatAssignments: Object.fromEntries(
          Object.entries(prev.seatAssignments)
            .filter(([key]) => key !== seatIndex)
        )
      } : null);
    }
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
        backgroundColor: '#f5f5f5',
        minHeight: 0
      }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStop={onNodeDragStop}
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

      {/* Overlay Controls */}
      <Box sx={{
        position: 'absolute',
        top: 16,
        left: 16,
        zIndex: 1000,
        backgroundColor: 'rgba(255, 255, 255, 0.9)',
        backdropFilter: 'blur(8px)',
        borderRadius: 2,
        boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
        p: 1
      }}>
        <Stack 
          direction="row" 
          spacing={1} 
          alignItems="center"
        >
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={handleAddTable}
            size="small"
          >
            הוסף שולחן
          </Button>
          <Button
            variant="contained"
            startIcon={<SaveIcon />}
            onClick={() => {/* TODO: Implement save */}}
            size="small"
          >
            שמור שינויים
          </Button>
          <Button
            variant="outlined"
            startIcon={<CancelIcon />}
            onClick={() => {/* TODO: Implement cancel */}}
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

      {/* Sidebar - Overlay */}
      <Paper sx={{ 
        position: 'absolute',
        top: 16, // Align with top controls
        right: 16,
        width: 300,
        p: 2,
        zIndex: 1000,
        backgroundColor: 'rgba(255, 255, 255, 0.9)',
        backdropFilter: 'blur(8px)',
        borderRadius: 2,
        boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
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
              <MenuItem value="משפחת כהן">משפחת כהן</MenuItem>
              <MenuItem value="חברים">חברים</MenuItem>
            </Select>
          </FormControl>

          <Divider />

          <Typography variant="subtitle2">אורחים ללא מקום ישיבה</Typography>
          
          <Box sx={{ 
            flex: 1,
            overflow: 'auto',
            minHeight: 0 // Important for flex child to respect parent height
          }}>
            {unseatedGuests.map((guest) => (
              <DraggableGuest key={guest._id} guest={guest} />
            ))}
          </Box>
        </Stack>
      </Paper>

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
              label="מספר מקומות"
              value={selectedTable?.seats || 8}
              inputProps={{ min: 1, max: 20 }}
              onChange={(e) => {
                const seats = parseInt(e.target.value);
                const style = selectedTable?.style || 'round';
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

                setSelectedTable(prev => prev ? { ...prev, seats, size } : null);
              }}
            />
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

      {/* Guest Search Modal */}
      <Dialog
        open={guestSearchModalOpen}
        onClose={() => {
          setGuestSearchModalOpen(false);
          setSelectedSeat(null);
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>בחר אורח</DialogTitle>
        <DialogContent>
          {selectedSeat && tables.find(t => t.id === selectedSeat.tableId)?.seatAssignments[selectedSeat.seatIndex.toString()] ? (
            // Show seated guest details
            <Box sx={{ mt: 2 }}>
              <Typography variant="subtitle1" gutterBottom>
                אורח ממושב זה:
              </Typography>
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
                <Button
                  variant="outlined"
                  color="error"
                  onClick={() => {
                    if (selectedSeat) {
                      const guestId = tables.find(t => t.id === selectedSeat.tableId)?.seatAssignments[selectedSeat.seatIndex.toString()];
                      if (guestId) {
                        handleRemoveGuestFromSeat(guestId, selectedSeat.tableId, selectedSeat.seatIndex.toString());
                      }
                    }
                    setGuestSearchModalOpen(false);
                    setSelectedSeat(null);
                  }}
                >
                  הסר אורח
                </Button>
                <Button
                  variant="outlined"
                  onClick={() => {
                    setGuestSearchValue('');
                    setGuestSearchResults([]);
                  }}
                >
                  החלף אורח
                </Button>
              </Stack>
            </Box>
          ) : (
            // Show search for new guest
            <>
              <TextField
                fullWidth
                placeholder="חיפוש אורחים..."
                value={guestSearchValue}
                onChange={(e) => handleGuestSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && guestSearchResults.length > 0) {
                    handleAssignGuestToSeat(guestSearchResults[0], selectedSeat?.seatIndex);
                    setGuestSearchModalOpen(false);
                    setSelectedSeat(null);
                  }
                }}
                sx={{ mt: 2 }}
              />
              <List>
                {guestSearchResults.map(guest => (
                  <ListItem
                    key={guest._id}
                    button
                    onClick={() => {
                      if (selectedSeat) {
                        handleAssignGuestToSeat(guest, selectedSeat.seatIndex);
                      }
                      setGuestSearchModalOpen(false);
                      setSelectedSeat(null);
                    }}
                  >
                    <ListItemText
                      primary={guest.name}
                      secondary={guest.group}
                    />
                    <Chip
                      label={statusLabels[guest.status]}
                      size="small"
                      sx={{
                        backgroundColor: `${statusColors[guest.status]}20`,
                        color: statusColors[guest.status],
                      }}
                    />
                  </ListItem>
                ))}
              </List>
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => {
            setGuestSearchModalOpen(false);
            setSelectedSeat(null);
          }}>ביטול</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}