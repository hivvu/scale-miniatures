// Export symbols (CSV), full disassembly listing and per-function decompilation to text files.
// Usage (headless): -postScript ExportProgramText.java <outDir>
// Writes <outDir>/symbols/<program>.csv (commit) and <outDir>/exports/<program>/{listing.asm,decomp.c} (gitignored).
//@category MicroMachines
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.*;
import ghidra.program.model.symbol.*;
import java.io.*;
import java.nio.file.*;

public class ExportProgramText extends GhidraScript {
    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        Path out = Paths.get(args.length > 0 ? args[0] : ".");
        String name = currentProgram.getName().replaceAll("[^A-Za-z0-9_.-]", "_");
        Path symDir = out.resolve("symbols");
        Path expDir = out.resolve("exports").resolve(name);
        Files.createDirectories(symDir);
        Files.createDirectories(expDir);

        // symbols.csv: address,name,type,size,comment  (user-defined or function symbols only)
        try (PrintWriter w = new PrintWriter(Files.newBufferedWriter(symDir.resolve(name + ".csv")))) {
            w.println("address,name,type,size,comment");
            SymbolTable st = currentProgram.getSymbolTable();
            for (Symbol s : st.getAllSymbols(false)) {
                if (s.getSource() == SourceType.DEFAULT) continue;
                String type = s.getSymbolType().toString().toLowerCase();
                long size = 0;
                String comment = "";
                if (s.getSymbolType() == SymbolType.FUNCTION) {
                    Function f = getFunctionAt(s.getAddress());
                    if (f != null) {
                        size = f.getBody().getNumAddresses();
                        String c = f.getComment();
                        if (c != null) comment = c;
                    }
                } else {
                    Data d = getDataAt(s.getAddress());
                    if (d != null) size = d.getLength();
                    String c = getPlateComment(s.getAddress());
                    if (c != null) comment = c;
                }
                w.printf("%s,%s,%s,%d,%s%n", s.getAddress(), csv(s.getName()), type, size, csv(comment));
            }
        }

        // listing.asm
        Listing listing = currentProgram.getListing();
        try (PrintWriter w = new PrintWriter(Files.newBufferedWriter(expDir.resolve("listing.asm")))) {
            CodeUnitIterator it = listing.getCodeUnits(true);
            while (it.hasNext() && !monitor.isCancelled()) {
                CodeUnit cu = it.next();
                Function f = listing.getFunctionAt(cu.getAddress());
                if (f != null) w.printf("%n;===== %s  %s%n", f.getName(), f.getEntryPoint());
                String plate = cu.getComment(CodeUnit.PLATE_COMMENT);
                if (plate != null) w.println("; " + plate.replace("\n", "\n; "));
                Symbol[] syms = cu.getSymbols();
                for (Symbol s : syms) if (f == null || !s.getName().equals(f.getName())) w.println(s.getName() + ":");
                String eol = cu.getComment(CodeUnit.EOL_COMMENT);
                w.printf("%-12s %-40s%s%n", cu.getAddress(), cu.toString(), eol != null ? " ; " + eol : "");
            }
        }

        // decomp.c
        DecompInterface di = new DecompInterface();
        di.openProgram(currentProgram);
        try (PrintWriter w = new PrintWriter(Files.newBufferedWriter(expDir.resolve("decomp.c")))) {
            FunctionIterator fi = listing.getFunctions(true);
            while (fi.hasNext() && !monitor.isCancelled()) {
                Function f = fi.next();
                DecompileResults r = di.decompileFunction(f, 60, monitor);
                w.printf("// ===== %s @ %s%n", f.getName(), f.getEntryPoint());
                if (r != null && r.decompileCompleted() && r.getDecompiledFunction() != null) {
                    w.println(r.getDecompiledFunction().getC());
                } else {
                    w.println("// decompilation failed: " + (r != null ? r.getErrorMessage() : "null"));
                }
            }
        } finally {
            di.dispose();
        }
        println("exported " + name + " to " + out);
    }

    private static String csv(String s) {
        if (s == null) return "";
        if (s.contains(",") || s.contains("\"") || s.contains("\n")) return "\"" + s.replace("\"", "\"\"").replace("\n", "\\n") + "\"";
        return s;
    }
}
