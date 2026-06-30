package com.nexova.commerce.ui

import androidx.compose.animation.*
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.nexova.commerce.db.Customer
import com.nexova.commerce.db.Database
import java.text.NumberFormat
import java.util.Locale

@Composable
fun CustomersScreen(@Suppress("UNUSED_PARAMETER") isOnline: Boolean, syncLogs: MutableList<String>) {
    var query by remember { mutableStateOf("") }
    var customers by remember { mutableStateOf<List<Customer>>(emptyList()) }
    var showAddDialog by remember { mutableStateOf(false) }
    var showEditDialog by remember { mutableStateOf<Customer?>(null) }

    val colors = LocalNexovaColors.current

    // Load customers
    LaunchedEffect(query) {
        customers = if (query.isEmpty()) {
            Database.getCustomers()
        } else {
            Database.searchCustomers(query)
        }
    }

    fun refresh() {
        customers = if (query.isEmpty()) {
            Database.getCustomers()
        } else {
            Database.searchCustomers(query)
        }
    }

    Box(Modifier.fillMaxSize()) {
        Column(
            Modifier
                .fillMaxSize()
                .background(colors.surface0)
                .padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
        // Header Row
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column {
                Text(
                    "Customer Directory",
                    color = colors.textPrimary,
                    fontSize = 24.sp,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    "Manage customer profiles, loyalty details, and tracking preferences.",
                    color = colors.textSecondary,
                    fontSize = 12.sp
                )
            }

            Button(
                onClick = { showAddDialog = true },
                colors = ButtonDefaults.buttonColors(
                    backgroundColor = colors.accent,
                    contentColor = colors.surface0
                ),
                shape = RoundedCornerShape(8.dp),
                elevation = ButtonDefaults.elevation(0.dp, 0.dp)
            ) {
                Text("+ Add Customer", fontWeight = FontWeight.Bold)
            }
        }

        // Search panel
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(colors.surface1, RoundedCornerShape(12.dp))
                .border(1.dp, colors.borderDefault, RoundedCornerShape(12.dp)),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text("⌕ ", color = colors.textSecondary, fontSize = 16.sp, modifier = Modifier.padding(start = 12.dp))
            BasicTextField(
                value = query,
                onValueChange = { query = it },
                textStyle = TextStyle(color = colors.textPrimary, fontSize = 14.sp),
                modifier = Modifier.weight(1f).padding(top = 12.dp, bottom = 12.dp, end = 12.dp, start = 4.dp),
                cursorBrush = SolidColor(colors.accent),
                decorationBox = { innerTextField ->
                    Box(contentAlignment = Alignment.CenterStart) {
                        if (query.isEmpty()) {
                            Text("Search by name, phone number, or email...", color = colors.textMuted, fontSize = 14.sp)
                        }
                        innerTextField()
                    }
                }
            )
        }

        // Table Header
        val borderDefaultColor = colors.borderDefault
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .drawBehind {
                    drawLine(borderDefaultColor, Offset(0f, size.height), Offset(size.width, size.height), 1f)
                }
                .padding(vertical = 12.dp, horizontal = 8.dp)
        ) {
            Text("Customer Info", modifier = Modifier.weight(2.5f), color = colors.textSecondary, fontWeight = FontWeight.SemiBold, fontSize = 12.sp)
            Text("Phone Number", modifier = Modifier.weight(2.0f), color = colors.textSecondary, fontWeight = FontWeight.SemiBold, fontSize = 12.sp)
            Text("Email Address", modifier = Modifier.weight(2.5f), color = colors.textSecondary, fontWeight = FontWeight.SemiBold, fontSize = 12.sp)
            Text("Visits", modifier = Modifier.weight(1.0f), color = colors.textSecondary, fontWeight = FontWeight.SemiBold, fontSize = 12.sp, textAlign = TextAlign.Center)
            Text("Total Spend", modifier = Modifier.weight(1.5f), color = colors.textSecondary, fontWeight = FontWeight.SemiBold, fontSize = 12.sp, textAlign = TextAlign.End)
            Text("Actions", modifier = Modifier.weight(1.5f), color = colors.textSecondary, fontWeight = FontWeight.SemiBold, fontSize = 12.sp, textAlign = TextAlign.Center)
        }

        // Table Rows
        LazyColumn(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            items(customers) { customer ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(colors.surface1, RoundedCornerShape(8.dp))
                        .border(1.dp, colors.borderSubtle, RoundedCornerShape(8.dp))
                        .clickable { showEditDialog = customer }
                        .padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    // Info
                    Row(
                        modifier = Modifier.weight(2.5f),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Box(
                            modifier = Modifier
                                .size(32.dp)
                                .background(colors.accentDim, CircleShape),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                customer.name.take(1).uppercase(Locale.US),
                                color = colors.accent,
                                fontWeight = FontWeight.Bold,
                                fontSize = 14.sp
                            )
                        }
                        Text(customer.name, color = colors.textPrimary, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                    }

                    // Phone
                    Text(customer.phone.ifEmpty { "—" }, modifier = Modifier.weight(2.0f), color = colors.textPrimary, fontSize = 13.sp)

                    // Email
                    Text(customer.email.ifEmpty { "—" }, modifier = Modifier.weight(2.5f), color = colors.textPrimary, fontSize = 13.sp)

                    // Visits
                    Text(customer.visits.toString(), modifier = Modifier.weight(1.0f), color = colors.textPrimary, fontSize = 13.sp, textAlign = TextAlign.Center, fontWeight = FontWeight.Medium)

                    // Spend
                    val spendStr = NumberFormat.getCurrencyInstance(Locale.US).format(customer.totalSpendCents / 100.0)
                    Text(spendStr, modifier = Modifier.weight(1.5f), color = colors.accent, fontSize = 14.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.End)

                    // Actions
                    Row(
                        modifier = Modifier.weight(1.5f),
                        horizontalArrangement = Arrangement.Center,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        TextButton(
                            onClick = { showEditDialog = customer },
                            colors = ButtonDefaults.textButtonColors(contentColor = colors.accent)
                        ) {
                            Text("Edit", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }

            if (customers.isEmpty()) {
                item {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(48.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Text("No customers found.", color = colors.textMuted, fontSize = 14.sp)
                    }
                }
            }
        }
    }

    // Add Dialog
    if (showAddDialog) {
        CustomerDialog(
            title = "Add Customer Profile",
            onDismiss = { showAddDialog = false },
            onConfirm = { name, phone, email ->
                Database.addCustomer(name, phone, email)
                syncLogs.add("Added customer: $name")
                showAddDialog = false
                refresh()
            }
        )
    }

    // Edit Dialog
    if (showEditDialog != null) {
        val cust = showEditDialog!!
        CustomerDialog(
            title = "Edit Customer Profile",
            initialName = cust.name,
            initialPhone = cust.phone,
            initialEmail = cust.email,
            onDismiss = { showEditDialog = null },
            onConfirm = { name, phone, email ->
                Database.updateCustomer(cust.id, name, phone, email)
                syncLogs.add("Updated customer: $name")
                showEditDialog = null
                refresh()
            },
            onDelete = {
                Database.deleteCustomer(cust.id)
                syncLogs.add("Deleted customer: ${cust.name}")
                showEditDialog = null
                refresh()
            }
        )
    }
    }
}

@Composable
fun CustomerDialog(
    title: String,
    initialName: String = "",
    initialPhone: String = "",
    initialEmail: String = "",
    onDismiss: () -> Unit,
    onConfirm: (String, String, String) -> Unit,
    onDelete: (() -> Unit)? = null
) {
    var name by remember { mutableStateOf(initialName) }
    var phone by remember { mutableStateOf(initialPhone) }
    var email by remember { mutableStateOf(initialEmail) }
    var error by remember { mutableStateOf("") }

    val colors = LocalNexovaColors.current

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = 0.5f))
            .clickable(enabled = false) {}, // Scrim
        contentAlignment = Alignment.Center
    ) {
        Column(
            modifier = Modifier
                .width(400.dp)
                .background(colors.surface2, RoundedCornerShape(16.dp))
                .border(1.dp, colors.borderDefault, RoundedCornerShape(16.dp))
                .padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Text(title, color = colors.textPrimary, fontSize = 18.sp, fontWeight = FontWeight.Bold)

            if (error.isNotEmpty()) {
                Text(error, color = colors.error, fontSize = 12.sp, fontWeight = FontWeight.Bold)
            }

            // Name
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("Full Name", color = colors.textSecondary, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                BasicTextField(
                    value = name,
                    onValueChange = { name = it },
                    textStyle = TextStyle(color = colors.textPrimary, fontSize = 14.sp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(colors.surface1, RoundedCornerShape(8.dp))
                        .border(1.dp, colors.borderSubtle, RoundedCornerShape(8.dp))
                        .padding(12.dp),
                    cursorBrush = SolidColor(colors.accent)
                )
            }

            // Phone
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("Phone Number", color = colors.textSecondary, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                BasicTextField(
                    value = phone,
                    onValueChange = { phone = it },
                    textStyle = TextStyle(color = colors.textPrimary, fontSize = 14.sp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(colors.surface1, RoundedCornerShape(8.dp))
                        .border(1.dp, colors.borderSubtle, RoundedCornerShape(8.dp))
                        .padding(12.dp),
                    cursorBrush = SolidColor(colors.accent)
                )
            }

            // Email
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("Email Address", color = colors.textSecondary, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                BasicTextField(
                    value = email,
                    onValueChange = { email = it },
                    textStyle = TextStyle(color = colors.textPrimary, fontSize = 14.sp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(colors.surface1, RoundedCornerShape(8.dp))
                        .border(1.dp, colors.borderSubtle, RoundedCornerShape(8.dp))
                        .padding(12.dp),
                    cursorBrush = SolidColor(colors.accent)
                )
            }

            // Buttons
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                if (onDelete != null) {
                    TextButton(
                        onClick = onDelete,
                        colors = ButtonDefaults.textButtonColors(contentColor = colors.error)
                    ) {
                        Text("Delete profile", fontWeight = FontWeight.Bold)
                    }
                } else {
                    Spacer(Modifier.width(1.dp))
                }

                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TextButton(
                        onClick = onDismiss,
                        colors = ButtonDefaults.textButtonColors(contentColor = colors.textSecondary)
                    ) {
                        Text("Cancel")
                    }

                    Button(
                        onClick = {
                            if (name.trim().isEmpty()) {
                                error = "Name is required."
                            } else {
                                onConfirm(name, phone, email)
                            }
                        },
                        colors = ButtonDefaults.buttonColors(
                            backgroundColor = colors.accent,
                            contentColor = colors.surface0
                        ),
                        shape = RoundedCornerShape(8.dp)
                    ) {
                        Text("Save Profile", fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
    }
}
