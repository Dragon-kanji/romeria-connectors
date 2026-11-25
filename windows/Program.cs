// Pilote Bluetooth FTMS du serveur local d'Ashiato (docs/connecteurs.md, « Le pilote FTMS »).
//
// Le serveur le lance et lui parle par lignes JSON sur l'entrée et la sortie standard. Le pilote ne
// fait que la radio : chercher les tapis FTMS, se connecter, transmettre les notifications brutes,
// écrire au point de contrôle. Le protocole FTMS, la fraîcheur des mesures et la reprise après une
// coupure sont dans le serveur (server/src/local/ftms), testés.
//
// Sécurité imposée, ici aussi : deux écritures seulement au point de contrôle (0x2AD9), la demande de
// contrôle (00) et Stop (08 01). Jamais Démarrer, jamais une vitesse ni une pente.

using System.Buffers;
using System.Text;
using System.Text.Json;
using Windows.Devices.Bluetooth;
using Windows.Devices.Bluetooth.Advertisement;
using Windows.Devices.Bluetooth.GenericAttributeProfile;
using Windows.Storage.Streams;

namespace Ashiato.Ftms;

internal static partial class Program
{
    private static readonly Guid FtmsService = Short(0x1826);
    private static readonly Guid TreadmillData = Short(0x2ACD);
    private static readonly Guid TrainingStatus = Short(0x2AD3);
    private static readonly Guid ControlPoint = Short(0x2AD9);
    private static readonly Guid MachineStatus = Short(0x2ADA);
    /// <summary>Les seules écritures permises au point de contrôle : demande de contrôle, Stop.</summary>
    private static readonly string[] AllowedWrites = ["00", "0801"];

    private static readonly object OutputLock = new();
    private static readonly SemaphoreSlim Gate = new(1, 1);
    private static Link? _link;

    private static Guid Short(ushort uuid) => new($"0000{uuid:x4}-0000-1000-8000-00805f9b34fb");

    private static bool _readOnly;
    private static async Task<int> Main(string[] args)
    {
        _readOnly = args.Contains("--lecture-seule");
        if (args.Contains("--self-test"))
        {
            EmitInspection(1, "F7:00:00:00:18:14", "Simulation", "RSC simulé", null,
                [Short(0x1814).ToString()], [Short(0x2a53).ToString()], [(Short(0x1814).ToString(), Short(0x2a53).ToString(), "00000150")], []);
            return 0;
        }
        Console.InputEncoding = Encoding.UTF8;
        Emit(w =>
        {
            w.WriteString("event", "ready");
            w.WriteString("pilot", "ashiato-ftms");
            w.WriteString("version", "1");
        });
        while (await Console.In.ReadLineAsync() is { } line)
        {
            if (line.Length == 0) continue;
            JsonDocument message;
            try
            {
                message = JsonDocument.Parse(line);
            }
            catch (JsonException)
            {
                Error("ligne illisible", null);
                continue;
            }
            using (message)
            {
                await Handle(message.RootElement);
            }
        }
        await Disconnect("fin du serveur", announce: false);
        CloseReadLink();
        return 0;
    }

    private static async Task Handle(JsonElement message)
    {
        var command = message.TryGetProperty("cmd", out var cmd) ? cmd.GetString() : null;
        int? id = message.TryGetProperty("id", out var idValue) && idValue.ValueKind == JsonValueKind.Number ? idValue.GetInt32() : null;
        if (_readOnly && command is not ("scan" or "inspect" or "read-connect" or "disconnect"))
        {
            Error("mode lecture seule : commande refusée", id);
            return;
        }
        switch (command)
        {
            case "inspect":
            case "read-connect":
                await Inspect(message, id, command == "read-connect");
                break;
            case "scan":
                var seconds = message.TryGetProperty("seconds", out var s) && s.ValueKind == JsonValueKind.Number ? Math.Clamp(s.GetInt32(), 1, 15) : 5;
                // `all` (diagnostic) : tous les appareils entendus, FTMS ou non, une fois chacun.
                var all = message.TryGetProperty("all", out var everything) && everything.ValueKind == JsonValueKind.True;
                _ = Task.Run(() => Scan(id, seconds, all));
                break;
            case "connect":
                var address = message.TryGetProperty("address", out var a) ? a.GetString() : null;
                await Gate.WaitAsync();
                try
                {
                    await Connect(address);
                }
                finally
                {
                    Gate.Release();
                }
                break;
            case "write":
                var hex = message.TryGetProperty("hex", out var h) ? h.GetString()?.ToLowerInvariant() : null;
                await Write(id, hex);
                break;
            case "disconnect":
                CloseReadLink();
                await Gate.WaitAsync();
                try
                {
                    await Disconnect("déconnexion demandée", announce: true);
                }
                finally
                {
                    Gate.Release();
                }
                break;
            default:
                Error($"commande inconnue : {command}", id);
                break;
        }
    }

    // --- Recherche ---------------------------------------------------------------------------------

    private static async Task Scan(int? id, int seconds, bool all)
    {
        var seen = new System.Collections.Concurrent.ConcurrentDictionary<ulong, string>();
        var watcher = new BluetoothLEAdvertisementWatcher { ScanningMode = BluetoothLEScanningMode.Active };
        watcher.Received += (_, args) =>
        {
            var advertisement = args.Advertisement;
            var name = advertisement.LocalName;
            if (!string.IsNullOrEmpty(name)) seen[args.BluetoothAddress] = name;
            var ftms = AdvertisesFtms(advertisement);
            if (!ftms && !all) return;
            Emit(w =>
            {
                w.WriteString("event", "device");
                if (id is { } value) w.WriteNumber("id", value);
                w.WriteString("address", FormatAddress(args.BluetoothAddress));
                w.WriteString("name", seen.GetValueOrDefault(args.BluetoothAddress, ""));
                w.WriteNumber("rssi", args.RawSignalStrengthInDBm);
                w.WriteBoolean("ftms", ftms);
                w.WriteStartArray("services");
                foreach (var uuid in advertisement.ServiceUuids) w.WriteStringValue(uuid.ToString());
                foreach (var section in advertisement.DataSections)
                {
                    if (section.DataType != 0x16 || section.Data.Length < 2) continue;
                    using var reader = DataReader.FromBuffer(section.Data);
                    reader.ByteOrder = ByteOrder.LittleEndian;
                    w.WriteStringValue(Short(reader.ReadUInt16()).ToString());
                }
                w.WriteEndArray();
            });
        };
        watcher.Stopped += (_, args) => { if (args.Error != BluetoothError.Success) Error($"radio Bluetooth : {args.Error}", id); };
        try
        {
            watcher.Start();
            await Task.Delay(TimeSpan.FromSeconds(seconds));
            watcher.Stop();
        }
        catch (Exception exception)
        {
            Error($"recherche Bluetooth impossible : {exception.Message}", id);
            return;
        }
        Emit(w =>
        {
            w.WriteString("event", "scan-done");
            if (id is { } value) w.WriteNumber("id", value);
        });
    }

    /// <summary>Le service 0x1826 annoncé, en liste de services ou en données de service.</summary>
    private static bool AdvertisesFtms(BluetoothLEAdvertisement advertisement)
    {
        if (advertisement.ServiceUuids.Contains(FtmsService)) return true;
        foreach (var section in advertisement.DataSections)
        {
            // Données de service, UUID 16 bits (0x16) : les deux premiers octets sont l'UUID.
            if (section.DataType != 0x16 || section.Data.Length < 2) continue;
            var reader = DataReader.FromBuffer(section.Data);
            reader.ByteOrder = ByteOrder.LittleEndian;
            if (reader.ReadUInt16() == 0x1826) return true;
        }
        return false;
    }

    // --- Liaison -----------------------------------------------------------------------------------

    private sealed class Link
    {
        public required BluetoothLEDevice Device;
        public required GattSession Session;
        public required GattDeviceService Service;
        public GattCharacteristic? Control;
        public readonly List<GattCharacteristic> Subscribed = [];
    }

    private static async Task Connect(string? address)
    {
        await Disconnect("nouvelle connexion", announce: false);
        if (address is null || !TryParseAddress(address, out var value))
        {
            Error("adresse Bluetooth invalide", null);
            return;
        }
        BluetoothLEDevice? device = null;
        try
        {
            device = await BluetoothLEDevice.FromBluetoothAddressAsync(value);
            if (device is null)
            {
                Error("tapis introuvable (éteint, hors de portée, ou déjà relié à un autre appareil)", null);
                return;
            }
            var session = await GattSession.FromDeviceIdAsync(device.BluetoothDeviceId);
            session.MaintainConnection = true;
            var services = await device.GetGattServicesForUuidAsync(FtmsService, BluetoothCacheMode.Uncached);
            if (services.Status != GattCommunicationStatus.Success || services.Services.Count == 0)
            {
                session.Dispose();
                device.Dispose();
                Error($"service FTMS introuvable ({services.Status})", null);
                return;
            }
            var service = services.Services[0];
            var characteristics = await service.GetCharacteristicsAsync(BluetoothCacheMode.Uncached);
            if (characteristics.Status != GattCommunicationStatus.Success)
            {
                service.Dispose();
                session.Dispose();
                device.Dispose();
                Error($"caractéristiques FTMS illisibles ({characteristics.Status})", null);
                return;
            }
            var byUuid = characteristics.Characteristics.ToDictionary(c => c.Uuid);
            byUuid.TryGetValue(ControlPoint, out var control);
            if (!byUuid.TryGetValue(TreadmillData, out var data))
            {
                service.Dispose();
                session.Dispose();
                device.Dispose();
                Error("ce n’est pas un tapis FTMS (pas de Treadmill Data)", null);
                return;
            }
            var link = new Link { Device = device, Session = session, Service = service, Control = control };
            await Subscribe(link, data, GattClientCharacteristicConfigurationDescriptorValue.Notify);
            if (control is not null) await Subscribe(link, control, GattClientCharacteristicConfigurationDescriptorValue.Indicate);
            if (byUuid.TryGetValue(MachineStatus, out var status)) await Subscribe(link, status, GattClientCharacteristicConfigurationDescriptorValue.Notify);
            if (byUuid.TryGetValue(TrainingStatus, out var training) && training.CharacteristicProperties.HasFlag(GattCharacteristicProperties.Notify))
                await Subscribe(link, training, GattClientCharacteristicConfigurationDescriptorValue.Notify);
            device.ConnectionStatusChanged += OnConnectionStatusChanged;
            _link = link;
            Emit(w =>
            {
                w.WriteString("event", "connected");
                w.WriteString("address", FormatAddress(value));
                w.WriteString("name", device.Name ?? "");
            });
        }
        catch (Exception exception)
        {
            device?.Dispose();
            Error($"connexion impossible : {exception.Message}", null);
        }
    }

    private static async Task Subscribe(Link link, GattCharacteristic characteristic, GattClientCharacteristicConfigurationDescriptorValue kind)
    {
        var status = await characteristic.WriteClientCharacteristicConfigurationDescriptorAsync(kind);
        if (status != GattCommunicationStatus.Success) throw new InvalidOperationException($"abonnement à {characteristic.Uuid} refusé ({status})");
        characteristic.ValueChanged += OnValueChanged;
        link.Subscribed.Add(characteristic);
    }

    private static void OnValueChanged(GattCharacteristic sender, GattValueChangedEventArgs args)
    {
        var reader = DataReader.FromBuffer(args.CharacteristicValue);
        var bytes = new byte[args.CharacteristicValue.Length];
        reader.ReadBytes(bytes);
        var uuid = sender.Uuid.ToString("D")[4..8];
        Emit(w =>
        {
            w.WriteString("event", "notify");
            w.WriteString("char", uuid);
            w.WriteString("hex", Convert.ToHexStringLower(bytes));
        });
    }

    private static void OnConnectionStatusChanged(BluetoothLEDevice sender, object args)
    {
        if (sender.ConnectionStatus != BluetoothConnectionStatus.Disconnected) return;
        _ = Task.Run(async () =>
        {
            await Gate.WaitAsync();
            try
            {
                if (_link?.Device == sender) await Disconnect("liaison radio perdue", announce: true);
            }
            finally
            {
                Gate.Release();
            }
        });
    }

    private static Task Disconnect(string reason, bool announce)
    {
        var link = _link;
        _link = null;
        if (link is null) return Task.CompletedTask;
        link.Device.ConnectionStatusChanged -= OnConnectionStatusChanged;
        foreach (var characteristic in link.Subscribed) characteristic.ValueChanged -= OnValueChanged;
        link.Service.Dispose();
        link.Session.Dispose();
        link.Device.Dispose();
        if (announce)
        {
            Emit(w =>
            {
                w.WriteString("event", "disconnected");
                w.WriteString("reason", reason);
            });
        }
        return Task.CompletedTask;
    }

    private static async Task Write(int? id, string? hex)
    {
        void Answer(bool ok, string? error) => Emit(w =>
        {
            w.WriteString("event", "written");
            if (id is { } value) w.WriteNumber("id", value);
            w.WriteBoolean("ok", ok);
            if (error is null) w.WriteNull("error");
            else w.WriteString("error", error);
        });
        if (hex is null || !AllowedWrites.Contains(hex))
        {
            Answer(false, "écriture refusée par le pilote : seuls la demande de contrôle et Stop partent");
            return;
        }
        var link = _link;
        if (link?.Control is null)
        {
            Answer(false, "déconnecté ou point de contrôle absent");
            return;
        }
        try
        {
            var writer = new DataWriter();
            writer.WriteBytes(Convert.FromHexString(hex));
            var result = await link.Control.WriteValueWithResultAsync(writer.DetachBuffer(), GattWriteOption.WriteWithResponse);
            Answer(result.Status == GattCommunicationStatus.Success, result.Status == GattCommunicationStatus.Success ? null : $"écriture refusée par le tapis ({result.Status})");
        }
        catch (Exception exception)
        {
            Answer(false, exception.Message);
        }
    }

    // --- Utilitaires -------------------------------------------------------------------------------

    private static string FormatAddress(ulong address) =>
        string.Join(':', Enumerable.Range(0, 6).Select(i => ((address >> (8 * (5 - i))) & 0xff).ToString("X2")));

    private static bool TryParseAddress(string text, out ulong value)
    {
        value = 0;
        var parts = text.Split(':');
        if (parts.Length != 6) return false;
        foreach (var part in parts)
        {
            if (part.Length != 2 || !byte.TryParse(part, System.Globalization.NumberStyles.HexNumber, null, out var octet)) return false;
            value = (value << 8) | octet;
        }
        return true;
    }

    private static void Error(string message, int? id) => Emit(w =>
    {
        w.WriteString("event", "error");
        if (id is { } value) w.WriteNumber("id", value);
        w.WriteString("message", message);
    });

    /// <summary>Une ligne JSON sur la sortie standard, une à la fois.</summary>
    private static void Emit(Action<Utf8JsonWriter> write)
    {
        var buffer = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer, new JsonWriterOptions { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping }))
        {
            writer.WriteStartObject();
            write(writer);
            writer.WriteEndObject();
        }
        var line = Encoding.UTF8.GetString(buffer.WrittenSpan);
        lock (OutputLock)
        {
            using var stdout = Console.OpenStandardOutput();
            var bytes = Encoding.UTF8.GetBytes(line + "\n");
            stdout.Write(bytes, 0, bytes.Length);
            stdout.Flush();
        }
    }
}
