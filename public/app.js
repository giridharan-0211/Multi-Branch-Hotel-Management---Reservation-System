const API = 'api.php';
const state = { token: localStorage.getItem('satoryuzei_token'), user: null, branches: [], selectedRoom: null, authMode: 'login', resumeBooking: false };
const authModal = new bootstrap.Modal(document.getElementById('authModal'));
const bookingModal = new bootstrap.Modal(document.getElementById('bookingModal'));
const receiptModal = new bootstrap.Modal(document.getElementById('receiptModal'));
const toast = new bootstrap.Toast(document.getElementById('appToast'), { delay: 3200 });
const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]);
const money = (value) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(value || 0));
const fallbackPhoto = 'https://images.unsplash.com/photo-1611892440504-42a792e24d32?auto=format&fit=crop&w=900&q=85';
const photo = (url) => /^https:\/\//i.test(String(url || '')) ? String(url) : fallbackPhoto;
let lastReceipt = null;
let receiptPdfUrl = null;
let availabilityRequestId = 0;

async function request(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  let response;
  try {
    response = await fetch(`${API}/${path}`, { ...options, headers });
  } catch {
    throw new Error('Cannot reach the hotel API. Check that the PHP server is running.');
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && state.token) clearSession();
    throw new Error(payload.error || 'Something went wrong. Please try again.');
  }
  return payload;
}

function renderReceipt(booking) {
  const rows = [
    ['Booking ID', booking.id],
    ['Guest name', booking.guest_name],
    ['Phone', booking.guest_phone],
    ['ID proof', `${booking.id_proof_type} ending ${booking.id_proof_last4}`],
    ['Hotel', `${booking.branch_name} · ${booking.branch_city}`],
    ['Address', booking.branch_address],
    ['Room', `${booking.room_name} · ${booking.room_type} · Unit #${booking.room_unit}`],
    ['Stay', `${formatDate(booking.check_in)} — ${formatDate(booking.check_out)}`],
    ['Guests', booking.guests],
    ['Payment method', String(booking.payment_method).toUpperCase()],
    ['Payment status', booking.payment_status],
    ['Booking status', booking.status],
  ];
  $('#receiptContent').innerHTML = `<div class="receipt-code">BOOKING #${escapeHtml(booking.id)}</div><dl>${rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}<div class="receipt-total"><dt>Total</dt><dd>${money(booking.total_price)}</dd></div></dl>`;
  prepareReceiptDownload(booking);
}

function prepareReceiptDownload(booking) {
  const link = $('#downloadReceipt');
  if (receiptPdfUrl) URL.revokeObjectURL(receiptPdfUrl);
  receiptPdfUrl = null;
  link.removeAttribute('href');
  link.removeAttribute('download');
  link.classList.add('disabled');
  link.setAttribute('aria-disabled', 'true');
  if (!window.jspdf?.jsPDF) return;
  const doc = new window.jspdf.jsPDF();
  const rows = [
    'Satoryuzei Palace', 'BOOKING CONFIRMATION', `Booking ID: ${booking.id}`, '',
    `Guest: ${booking.guest_name}`, `Phone: ${booking.guest_phone}`,
    `ID proof: ${booking.id_proof_type} ending ${booking.id_proof_last4}`,
    `Hotel: ${booking.branch_name}, ${booking.branch_city}`, `Address: ${booking.branch_address}`,
    `Room: ${booking.room_name} (${booking.room_type}) · Unit #${booking.room_unit}`,
    `Stay: ${booking.check_in} to ${booking.check_out}`, `Guests: ${booking.guests}`,
    `Payment method: ${String(booking.payment_method).toUpperCase()}`,
    `Payment status: ${booking.payment_status}`, `Booking status: ${booking.status}`,
    `Total: INR ${Number(booking.total_price).toLocaleString('en-IN')}`,
  ];
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text(rows, 16, 20, { maxWidth: 178, lineHeightFactor: 1.6 });
  receiptPdfUrl = URL.createObjectURL(doc.output('blob'));
  link.href = receiptPdfUrl;
  link.download = `Satoryuzei-booking-${booking.id}.pdf`;
  link.classList.remove('disabled');
  link.removeAttribute('aria-disabled');
}

function showToast(message) {
  $('#toastMessage').textContent = message;
  toast.show();
}

function setUser(user) {
  state.user = user;
  $('#authNav').textContent = user ? 'Sign out' : 'Sign in';
  $('#tripsNav').textContent = 'My Bookings';
  $('#tripsNav').title = user ? `View ${user.name}'s booking records` : '';
  $('#tripsNav').classList.toggle('d-none', !user);
  $('#adminNav').classList.toggle('d-none', !user || user.role !== 'admin');
  $('#accountMenuDivider').classList.toggle('d-none', !user);
}

function clearSession() {
  state.token = null;
  localStorage.removeItem('satoryuzei_token');
  setUser(null);
}

async function loadBranches() {
  try {
    const data = await request('branches');
    state.branches = data.branches;
    $('#adminBranchSelect').innerHTML = '<option value="">Choose property</option>' + state.branches.map((branch) => `<option value="${branch.id}">${escapeHtml(branch.name)} · ${escapeHtml(branch.city)}</option>`).join('');
    $('#collectionGrid').innerHTML = state.branches.map((branch, index) => `<article class="property-showcase"><div class="property-photo-wrap"><img class="property-photo" src="${escapeHtml(photo(branch.image_url))}" alt="Satoryuzei Palace, ${escapeHtml(branch.city)}" loading="lazy"><span class="property-photo-label">S / 0${index + 1}</span></div><div class="property-copy"><p class="eyebrow">SATORYUZEI PALACE · ${escapeHtml(branch.city.toUpperCase())}</p><h3>${escapeHtml(branch.city)},<br><em>at your own pace.</em></h3><p class="property-description">${escapeHtml(branch.description)}</p><div class="hospitality-notes"><div><h4>FOOD & DINING</h4><p>${escapeHtml(branch.food_description)}</p></div><div><h4>ROOM SERVICE</h4><p>${escapeHtml(branch.service_description)}</p></div></div><button class="text-link property-book" type="button" data-branch="${branch.id}">Find a room in ${escapeHtml(branch.city)} <span aria-hidden="true">↗</span></button></div></article>`).join('');
  } catch (error) {
    $('#searchMessage').textContent = error.message;
  }
}

async function showBranchRooms(branchId) {
  if (!branchId) {
    $('#searchMessage').textContent = 'Choose a destination to see available rooms.';
    return;
  }
  $('#searchMessage').textContent = 'Finding your room…';
  try {
    const checkIn = $('#bookingCheckIn').value;
    const checkOut = $('#bookingCheckOut').value;
    const availabilityDates = checkIn && checkOut && checkOut > checkIn
      ? `?${new URLSearchParams({ check_in: checkIn, check_out: checkOut })}`
      : '';
    const data = await request(`branches/${branchId}/rooms${availabilityDates}`);
    const branch = state.branches.find((item) => Number(item.id) === Number(branchId));
    $('#roomsTitle').textContent = branch ? `${branch.name} · ${branch.city}` : 'Available rooms';
    $('#roomGrid').innerHTML = data.rooms.length ? data.rooms.map((room) => `<article class="room-card"><img class="room-card-photo" src="${escapeHtml(photo(room.image_url))}" alt="${escapeHtml(room.name)} room" loading="lazy"><div class="room-card-content"><div class="room-meta">${escapeHtml(room.room_type)} · UP TO ${room.capacity} GUESTS</div><h4 class="mt-2">${escapeHtml(room.name)}</h4><p>${escapeHtml(room.description)}</p><div class="room-bottom"><div class="room-price"><strong>${money(room.price_per_night)}</strong> <span>/ night</span></div><button class="btn btn-rust btn-sm" type="button" data-room="${room.id}" data-branch="${branchId}" data-name="${escapeHtml(room.name)}" data-price="${room.price_per_night}" data-type="${escapeHtml(room.room_type)}" data-capacity="${room.capacity}" ${Number(room.available_rooms ?? room.inventory_count ?? 20) < 1 ? 'disabled' : ''}>${Number(room.available_rooms ?? room.inventory_count ?? 20) < 1 ? 'Fully booked' : 'Choose room'}</button></div></div></article>`).join('') : '<p class="text-muted mb-0">No rooms listed for this location.</p>';
    $('#roomsSection').classList.remove('d-none');
    $('#searchMessage').textContent = `${data.rooms.length} room option${data.rooms.length === 1 ? '' : 's'} at ${branch?.city || 'this location'}.`;
    $('#roomsSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    $('#searchMessage').textContent = error.message;
  }
}

function openAuth(mode = 'login', message = '') {
  setAuthMode(mode);
  $('#authError').textContent = message;
  authModal.show();
}

function setAuthMode(mode) {
  state.authMode = mode;
  $('#authTitle').textContent = mode === 'login' ? 'Sign in' : 'Create your account';
  $('#authSubmit').textContent = mode === 'login' ? 'Continue' : 'Create account';
  $('#nameField').classList.toggle('d-none', mode === 'login');
  $('#authName').required = mode === 'register';
  $('#authPassword').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  document.querySelectorAll('[data-auth-mode]').forEach((button) => button.classList.toggle('active', button.dataset.authMode === mode));
}

async function signOut(announce = true) {
  if (state.token) {
    try { await request('auth/logout', { method: 'POST' }); } catch { /* Local sign-out still completes. */ }
  }
  clearSession();
  hideViews();
  if (announce) showToast('You have signed out.');
}

function hideViews() {
  $('#tripsView').classList.add('d-none');
  $('#adminView').classList.add('d-none');
  $('#heroSection').classList.remove('d-none');
  $('#collection').classList.remove('d-none');
  document.querySelector('.quiet-note').classList.remove('d-none');
}

function showHome() {
  hideViews();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function loadTrips() {
  hideViews();
  $('#collection').classList.add('d-none');
  document.querySelector('.quiet-note').classList.add('d-none');
  $('#heroSection').classList.add('d-none');
  $('#tripsView').classList.remove('d-none');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  $('#bookingList').innerHTML = '<p class="text-muted">Loading your stays…</p>';
  try {
    const data = await request('bookings');
    const today = localDateString(new Date());
    const upcoming = data.bookings.filter((booking) => booking.status === 'confirmed' && booking.check_out >= today);
    const history = data.bookings.filter((booking) => !upcoming.includes(booking));
    const renderBooking = (booking, cancellable = false) => `<article class="booking-row"><div><h3>${escapeHtml(booking.branch_name)}</h3><p>Booking #${escapeHtml(booking.id)} · ${escapeHtml(booking.branch_city)} · ${escapeHtml(booking.room_name)} (${escapeHtml(booking.room_type)}) · Unit #${escapeHtml(booking.room_unit)}</p></div><div><strong>${formatDate(booking.check_in)} — ${formatDate(booking.check_out)}</strong><p>${booking.guests} guest${Number(booking.guests) === 1 ? '' : 's'}</p></div><div><span class="status-label ${booking.status}">${escapeHtml(booking.status === 'confirmed' ? 'Confirmed' : 'Cancelled')}</span><p>${money(booking.total_price)} total</p></div>${cancellable ? `<button class="btn btn-sm btn-outline-dark" data-cancel="${booking.id}">Cancel Booking</button>` : ''}</article>`;
    $('#bookingList').innerHTML = data.bookings.length
      ? `<section class="booking-group"><h3>Active & upcoming bookings</h3>${upcoming.length ? upcoming.map((booking) => renderBooking(booking, true)).join('') : '<p class="booking-empty">No active or upcoming bookings.</p>'}</section><section class="booking-group"><h3>Booking history</h3>${history.length ? history.map((booking) => renderBooking(booking)).join('') : '<p class="booking-empty">No past or cancelled bookings yet.</p>'}</section>`
      : '<div class="booking-empty"><h3>No bookings yet</h3><p>Your next good story starts with a destination.</p></div>';
    return;
    $('#bookingList').innerHTML = data.bookings.length ? data.bookings.map((booking) => `<article class="booking-row"><div><h3>${escapeHtml(booking.branch_name)}</h3><p>${escapeHtml(booking.branch_city)} · ${escapeHtml(booking.room_name)} · Unit #${escapeHtml(booking.room_unit)}</p></div><div><strong>${formatDate(booking.check_in)} — ${formatDate(booking.check_out)}</strong><p>${booking.guests} guest${Number(booking.guests) === 1 ? '' : 's'}</p></div><div><span class="status-label ${booking.status}">${escapeHtml(booking.status)}</span><p>${money(booking.total_price)} total</p></div>${booking.status === 'confirmed' ? `<button class="btn btn-sm btn-outline-dark" data-cancel="${booking.id}">Cancel</button>` : ''}</article>`).join('') : '<p class="text-muted">No stays yet. Your next good story starts with a destination.</p>';
  } catch (error) { $('#bookingList').innerHTML = `<p class="form-error">${escapeHtml(error.message)}</p>`; }
}

function formatDate(value) {
  return new Date(`${value}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function localDateString(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function updateBookingSummary() {
  if (!state.selectedRoom) return;
  const checkIn = $('#bookingCheckIn').value;
  const checkOut = $('#bookingCheckOut').value;
  const guests = Number($('#bookingGuestCount').value);
  if (!checkIn || !checkOut || checkOut <= checkIn) {
    $('#bookingDetails').innerHTML = `<strong>${escapeHtml(state.selectedRoom.name)}</strong><br>${escapeHtml(state.selectedRoom.type)} at ${escapeHtml($('#roomsTitle').textContent)}<br>Choose valid stay dates to continue.`;
    return;
  }
  const nights = Math.round((new Date(`${checkOut}T00:00:00`) - new Date(`${checkIn}T00:00:00`)) / 86400000);
  $('#bookingDetails').innerHTML = `<strong>${escapeHtml(state.selectedRoom.name)}</strong><br>${escapeHtml(state.selectedRoom.type)} at ${escapeHtml($('#roomsTitle').textContent)}<br>${formatDate(checkIn)} — ${formatDate(checkOut)} · ${guests} guests<br><br>${nights} night${nights === 1 ? '' : 's'} × ${money(state.selectedRoom.price)} = <strong>${money(nights * state.selectedRoom.price)}</strong>`;
}

async function updateBookingAvailability() {
  const availability = $('#bookingAvailability');
  if (!state.selectedRoom) return;
  const checkIn = $('#bookingCheckIn').value;
  const checkOut = $('#bookingCheckOut').value;
  if (!checkIn || !checkOut || checkOut <= checkIn) {
    availability.textContent = 'Choose valid dates to check availability.';
    availability.classList.remove('is-unavailable');
    return;
  }
  const requestId = ++availabilityRequestId;
  availability.textContent = 'Checking availability…';
  availability.classList.remove('is-unavailable');
  try {
    const dates = new URLSearchParams({ check_in: checkIn, check_out: checkOut });
    const data = await request(`branches/${state.selectedRoom.branchId}/rooms?${dates}`);
    if (requestId !== availabilityRequestId) return;
    const room = data.rooms.find((item) => Number(item.id) === state.selectedRoom.id);
    const available = Number(room?.available_rooms ?? 0);
    const inventory = Number(room?.inventory_count ?? 0);
    availability.textContent = available > 0
      ? `${available} of ${inventory} rooms available for these dates.`
      : 'This room is fully booked for these dates.';
    availability.classList.toggle('is-unavailable', available < 1);
  } catch {
    if (requestId === availabilityRequestId) availability.textContent = 'Availability could not be checked. Please try again.';
  }
}

async function loadAdmin() {
  hideViews();
  $('#collection').classList.add('d-none');
  document.querySelector('.quiet-note').classList.add('d-none');
  $('#heroSection').classList.add('d-none');
  $('#adminView').classList.remove('d-none');
  try {
    const data = await request('admin/overview');
    const summary = data.summary;
    $('#adminSummary').innerHTML = [['Properties', summary.branches], ['Active rooms', summary.rooms], ['Confirmed stays', summary.active_bookings], ['Booked revenue', money(summary.booked_revenue)]].map(([label, value]) => `<div class="summary-item"><span>${label}</span><strong>${value}</strong></div>`).join('');
    $('#adminBranches').innerHTML = data.branches.map((branch) => `<div class="branch-admin-row"><div><strong>${escapeHtml(branch.name)}</strong><small>${escapeHtml(branch.city)} · ${branch.room_count} rooms</small></div><span>From ${money(branch.starting_price)}</span></div>`).join('');
    $('#adminBranchSelect').innerHTML = '<option value="">Choose property</option>' + data.branches.map((branch) => `<option value="${branch.id}">${escapeHtml(branch.name)} · ${escapeHtml(branch.city)}</option>`).join('');
    await loadAdminBookings();
  } catch (error) { $('#adminSummary').innerHTML = `<p class="form-error">${escapeHtml(error.message)}</p>`; }
}

async function loadAdminBookings() {
  try {
    const data = await request('bookings?all=true');
    $('#adminBookingList').innerHTML = data.bookings.length ? data.bookings.map((booking) => `<article class="booking-row"><div><h3>${escapeHtml(booking.branch_name)}</h3><p>${escapeHtml(booking.branch_city)} · ${escapeHtml(booking.room_name)} · Unit #${escapeHtml(booking.room_unit)}</p></div><div><strong>${formatDate(booking.check_in)} — ${formatDate(booking.check_out)}</strong><p>${booking.guests} guest${Number(booking.guests) === 1 ? '' : 's'}</p></div><div><span class="status-label ${booking.status}">${escapeHtml(booking.status)}</span><p>${money(booking.total_price)}</p></div>${booking.status === 'confirmed' ? `<button class="btn btn-sm btn-outline-dark" data-cancel="${booking.id}">Cancel</button>` : ''}</article>`).join('') : '<p class="text-muted">No bookings recorded.</p>';
  } catch (error) { $('#adminBookingList').innerHTML = `<p class="form-error">${escapeHtml(error.message)}</p>`; }
}

$('#collectionGrid').addEventListener('click', (event) => {
  const button = event.target.closest('[data-branch]');
  if (!button) return;
  showBranchRooms(button.dataset.branch);
});
$('#roomGrid').addEventListener('click', (event) => {
  const button = event.target.closest('[data-room]');
  if (!button) return;
  lastReceipt = null;
  state.selectedRoom = { id: Number(button.dataset.room), branchId: Number(button.dataset.branch), name: button.dataset.name, type: button.dataset.type, price: Number(button.dataset.price), capacity: Number(button.dataset.capacity) };
  [...$('#bookingGuestCount').options].forEach((option) => { option.disabled = Number(option.value) > state.selectedRoom.capacity; });
  $('#bookingGuestCount').value = '2';
  $('#bookingGuestName').value = state.user?.name || '';
  updateBookingSummary();
  updateBookingAvailability();
  $('#bookingError').textContent = '';
  if (!state.user) {
    state.resumeBooking = true;
    openAuth('login', 'Please log in to book a room.');
    return;
  }
  bookingModal.show();
});
$('#bookingCheckIn').addEventListener('change', () => {
  const next = new Date(`${$('#bookingCheckIn').value}T00:00:00`);
  next.setDate(next.getDate() + 1);
  $('#bookingCheckOut').min = localDateString(next);
  if ($('#bookingCheckOut').value <= $('#bookingCheckIn').value) $('#bookingCheckOut').value = localDateString(next);
  updateBookingSummary();
  updateBookingAvailability();
});
$('#bookingCheckOut').addEventListener('change', () => { updateBookingSummary(); updateBookingAvailability(); });
$('#bookingGuestCount').addEventListener('change', updateBookingSummary);
['bookingGuestPhone', 'bookingIdLast4'].forEach((id) => {
  $(`#${id}`).addEventListener('input', (event) => {
    event.target.value = event.target.value.replace(/\D/g, '');
  });
});
$('#bookingModal').addEventListener('hidden.bs.modal', () => {
  if (!lastReceipt) return;
  renderReceipt(lastReceipt);
  receiptModal.show();
});
$('#confirmBooking').addEventListener('click', async () => {
  const requiredFields = ['bookingCheckIn', 'bookingCheckOut', 'bookingGuestName', 'bookingGuestPhone', 'bookingIdType', 'bookingIdLast4'];
  const invalidField = requiredFields.map((id) => $(`#${id}`)).find((field) => !field.checkValidity());
  if (invalidField) {
    invalidField.reportValidity();
    return;
  }
  const checkIn = $('#bookingCheckIn').value;
  const checkOut = $('#bookingCheckOut').value;
  if (!checkIn || !checkOut || checkOut <= checkIn) {
    $('#bookingError').textContent = 'Choose valid check-in and check-out dates.';
    return;
  }
  if (!state.user) { state.resumeBooking = true; bookingModal.hide(); openAuth('login', 'Please log in to book a room.'); return; }
  const button = $('#confirmBooking');
  button.disabled = true;
  try {
    const result = await request('bookings', { method: 'POST', body: JSON.stringify({
      room_id: state.selectedRoom.id,
      check_in: checkIn,
      check_out: checkOut,
      guests: Number($('#bookingGuestCount').value),
      guest_name: $('#bookingGuestName').value.trim(),
      guest_phone: $('#bookingGuestPhone').value.trim(),
      id_proof_type: $('#bookingIdType').value,
      id_proof_last4: $('#bookingIdLast4').value,
      payment_method: document.querySelector('input[name="bookingPaymentMethod"]:checked')?.value,
    }) });
    lastReceipt = result.booking;
    bookingModal.hide();
    await showBranchRooms(state.selectedRoom.branchId);
  } catch (error) { $('#bookingError').textContent = error.message; }
  finally { button.disabled = false; }
});

document.querySelectorAll('[data-auth-mode]').forEach((button) => button.addEventListener('click', () => setAuthMode(button.dataset.authMode)));
$('#authNav').addEventListener('click', () => state.user ? signOut() : openAuth());
$('#authForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const endpoint = state.authMode === 'login' ? 'auth/login' : 'auth/register';
  $('#authError').textContent = '';
  try {
    const data = await request(endpoint, { method: 'POST', body: JSON.stringify(Object.fromEntries(form.entries())) });
    state.token = data.token;
    localStorage.setItem('satoryuzei_token', data.token);
    setUser(data.user);
    authModal.hide();
    event.currentTarget.reset();
    showToast(`Welcome${data.user.name ? `, ${data.user.name.split(' ')[0]}` : ' back'}.`);
    if (state.resumeBooking && state.selectedRoom) $('#bookingGuestName').value = data.user.name || '';
  } catch (error) { $('#authError').textContent = error.message; }
});

$('#authModal').addEventListener('hidden.bs.modal', () => {
  if (state.resumeBooking && state.user && state.selectedRoom) {
    state.resumeBooking = false;
    bookingModal.show();
  } else if (!state.user) {
    state.resumeBooking = false;
  }
});

document.addEventListener('click', async (event) => {
  const cancel = event.target.closest('[data-cancel]');
  if (cancel && window.confirm('Cancel this reservation? This cannot be undone.')) {
    cancel.disabled = true;
    try {
      await request(`bookings/${cancel.dataset.cancel}/cancel`, { method: 'PATCH' });
      showToast('Reservation cancelled. The room is available for those dates again.');
      if (!$('#roomsSection').classList.contains('d-none') && state.selectedRoom) await showBranchRooms(state.selectedRoom.branchId);
      state.user.role === 'admin' && !$('#adminView').classList.contains('d-none') ? await loadAdmin() : await loadTrips();
    }
    catch (error) { showToast(error.message); }
  }
  const viewButton = event.target.closest('[data-view]');
  if (viewButton?.dataset.view === 'trips') loadTrips();
  if (viewButton?.dataset.view === 'admin') loadAdmin();
});
$('#refreshTrips').addEventListener('click', loadTrips);
$('#backToHome').addEventListener('click', showHome);
$('#refreshAdmin').addEventListener('click', loadAdmin);
$('#refreshAdminBookings').addEventListener('click', loadAdminBookings);
$('#closeRooms').addEventListener('click', () => $('#roomsSection').classList.add('d-none'));

$('#branchForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  try { await request('admin/branches', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget).entries())) }); event.currentTarget.reset(); showToast('Property added.'); await loadBranches(); await loadAdmin(); }
  catch (error) { showToast(error.message); }
  finally { button.disabled = false; }
});
$('#roomForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget).entries());
  values.branch_id = Number(values.branch_id); values.capacity = Number(values.capacity); values.price_per_night = Number(values.price_per_night);
  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  try { await request('admin/rooms', { method: 'POST', body: JSON.stringify(values) }); event.currentTarget.reset(); showToast('Room added.'); await loadBranches(); await loadAdmin(); }
  catch (error) { showToast(error.message); }
  finally { button.disabled = false; }
});

async function init() {
  $('#year').textContent = new Date().getFullYear();
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const dayAfter = new Date(); dayAfter.setDate(dayAfter.getDate() + 2);
  $('#bookingCheckIn').min = localDateString(tomorrow);
  $('#bookingCheckIn').value = localDateString(tomorrow);
  $('#bookingCheckOut').min = localDateString(dayAfter);
  $('#bookingCheckOut').value = localDateString(dayAfter);
  await loadBranches();
  if (state.token) {
    try { const data = await request('auth/me'); setUser(data.user); }
    catch { state.token = null; localStorage.removeItem('satoryuzei_token'); setUser(null); }
  } else setUser(null);
}

init();
